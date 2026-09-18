#!/usr/bin/env node
// FILE: verify-packaged-desktop-startup.ts
// Purpose: Launches a packaged desktop payload from an isolated temporary tree before upload.
// Layer: Release verification script

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { GRAFT_MAC_BACKEND_NODE_RUNTIME_RELATIVE_PATH } from "@graft/shared/desktopIdentity";

export type PackagedDesktopPlatform = "linux" | "mac" | "win";

export interface PackagedDesktopStartupOptions {
  readonly assetsDirectory: string;
  readonly platform: PackagedDesktopPlatform;
  readonly arch: string;
  readonly version: string;
  readonly timeoutMs: number;
}

export function parsePackagedDesktopStartupArgs(
  argv: ReadonlyArray<string>,
): PackagedDesktopStartupOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined || values.has(name)) {
      throw new Error(`Invalid packaged startup argument near ${name ?? "<end>"}.`);
    }
    values.set(name, value);
  }
  const known = new Set(["--assets-dir", "--platform", "--arch", "--version", "--timeout-ms"]);
  for (const name of values.keys()) {
    if (!known.has(name)) throw new Error(`Unknown packaged startup argument: ${name}.`);
  }
  const required = (name: string): string => {
    const value = values.get(name)?.trim();
    if (!value) throw new Error(`Missing packaged startup argument: ${name}.`);
    return value;
  };
  const platform = required("--platform");
  if (platform !== "linux" && platform !== "mac" && platform !== "win") {
    throw new Error(`Unsupported packaged startup platform: ${platform}.`);
  }
  const timeoutMs = Number(values.get("--timeout-ms") ?? "60000");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 180_000) {
    throw new Error("--timeout-ms must be an integer between 5000 and 180000.");
  }
  return {
    assetsDirectory: resolve(required("--assets-dir")),
    platform,
    arch: required("--arch"),
    version: required("--version"),
    timeoutMs,
  };
}

function runCommand(command: string, args: ReadonlyArray<string>, cwd?: string): void {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`${command} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status ?? "unknown"}.`);
  }
}

const MAC_KEYCHAIN_COMMAND_TIMEOUT_MS = 15_000;

export function redactMacKeychainCommandArgs(args: ReadonlyArray<string>): string {
  return args
    .map((argument, index) => (args[index - 1] === "-p" ? "<redacted>" : argument))
    .join(" ");
}

function macKeychainFailureDetail(stderr: string, args: ReadonlyArray<string>): string {
  let detail = stderr.trim().slice(-4_096);
  for (let index = 1; index < args.length; index += 1) {
    if (args[index - 1] === "-p" && args[index]) {
      detail = detail.replaceAll(args[index]!, "<redacted>");
    }
  }
  return detail ? ` stderr=${detail}` : "";
}

function runMacKeychainCommand(args: ReadonlyArray<string>): void {
  const result = spawnSync("security", [...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: MAC_KEYCHAIN_COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(
      `security ${redactMacKeychainCommandArgs(args)} could not complete: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `security ${redactMacKeychainCommandArgs(args)} failed with exit ${result.status ?? "unknown"}.${macKeychainFailureDetail(result.stderr, args)}`,
    );
  }
}

function readMacKeychainCommand(args: ReadonlyArray<string>): string {
  const result = spawnSync("security", [...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: MAC_KEYCHAIN_COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(
      `security ${redactMacKeychainCommandArgs(args)} could not complete: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `security ${redactMacKeychainCommandArgs(args)} failed with exit ${result.status ?? "unknown"}.${macKeychainFailureDetail(result.stderr, args)}`,
    );
  }
  return result.stdout;
}

export function parseMacKeychainList(output: string): string[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line.startsWith('"') && line.endsWith('"')) {
        return line.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
      }
      return line;
    });
}

export interface MacSmokeKeychainCommandRunner {
  readonly read: (args: ReadonlyArray<string>) => string;
  readonly run: (args: ReadonlyArray<string>) => void;
}

interface MacSmokeProcessGroupRecovery {
  readonly id: number;
  readonly identity: string;
}

interface MacSmokeKeychainRecovery {
  readonly schemaVersion: 2;
  readonly ownerPid: number;
  readonly ownerIdentity: string;
  readonly keychainPath: string;
  readonly previousDefault: string | null;
  readonly previousSearchList: string[];
  readonly processGroup: MacSmokeProcessGroupRecovery | null;
}

export interface MacSmokeKeychainLock {
  readonly ownerIdentity: string;
  readonly persistRecovery: (recovery: MacSmokeKeychainRecovery) => void;
  readonly release: () => void;
}

interface AcquireMacSmokeKeychainLockOptions {
  readonly lockDirectory?: string;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly isProcessGroupAlive?: (pid: number) => boolean;
  readonly getProcessIdentity?: (pid: number) => string | null;
  readonly terminateProcessGroup?: (pid: number) => void;
}

interface PrepareMacSmokeKeychainOptions {
  readonly commands?: MacSmokeKeychainCommandRunner;
  readonly password?: string;
  readonly acquireLock?: (commands: MacSmokeKeychainCommandRunner) => MacSmokeKeychainLock;
}

export interface MacSmokeKeychainSession {
  readonly prepare: () => void;
  readonly recordProcessGroup: (pid: number, identity: string) => void;
  readonly restore: () => void;
}

const macSmokeKeychainCommands: MacSmokeKeychainCommandRunner = {
  read: readMacKeychainCommand,
  run: runMacKeychainCommand,
};

function isLiveProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function resolveMacSmokeKeychainStateDirectory(userHome: string = homedir()): string {
  return join(resolve(userHome), ".graft", "release-smoke", "macos-keychain");
}

export function resolveMacSmokeKeychainLockDirectory(userHome: string = homedir()): string {
  return join(resolveMacSmokeKeychainStateDirectory(userHome), "state.lock");
}

export function readMacSmokeProcessIdentity(pid: number): string | null {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart=", "-o", "command="], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: MAC_KEYCHAIN_COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  const identity = result.stdout.trim();
  return identity.length > 0 ? identity : null;
}

interface MacSmokeLockOwner {
  readonly schemaVersion: 1;
  readonly pid: number;
  readonly identity: string;
}

function parseMacSmokeLockOwner(value: string): MacSmokeLockOwner {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("The packaged macOS startup smoke lock owner is invalid.");
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    !Number.isSafeInteger(record.pid) ||
    (record.pid as number) <= 0 ||
    typeof record.identity !== "string" ||
    record.identity.length === 0
  ) {
    throw new Error("The packaged macOS startup smoke lock owner is invalid.");
  }
  return {
    schemaVersion: 1,
    pid: record.pid as number,
    identity: record.identity,
  };
}

function parseMacSmokeKeychainRecovery(
  value: string,
  allowedStateDirectory: string,
): MacSmokeKeychainRecovery {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("The packaged macOS startup smoke recovery record is invalid.");
  }
  const record = parsed as Record<string, unknown>;
  const keychainPath = record.keychainPath;
  const keychainRoot = typeof keychainPath === "string" ? resolve(dirname(keychainPath)) : "";
  const resolvedStateDirectory = resolve(allowedStateDirectory);
  const processGroup = record.processGroup as Record<string, unknown> | null;
  const isValidProcessGroup =
    processGroup === null ||
    (processGroup !== undefined &&
      Number.isSafeInteger(processGroup.id) &&
      (processGroup.id as number) > 0 &&
      typeof processGroup.identity === "string" &&
      processGroup.identity.length > 0);
  const isSafeKeychainPath =
    typeof keychainPath === "string" &&
    basename(keychainPath) === "graft-packaged-smoke.keychain-db" &&
    basename(keychainRoot).startsWith("keychain-") &&
    keychainRoot.startsWith(`${resolvedStateDirectory}${sep}`);
  if (
    record.schemaVersion !== 2 ||
    !Number.isSafeInteger(record.ownerPid) ||
    (record.ownerPid as number) <= 0 ||
    typeof record.ownerIdentity !== "string" ||
    record.ownerIdentity.length === 0 ||
    !isSafeKeychainPath ||
    !(record.previousDefault === null || typeof record.previousDefault === "string") ||
    !Array.isArray(record.previousSearchList) ||
    !record.previousSearchList.every((entry) => typeof entry === "string") ||
    !isValidProcessGroup
  ) {
    throw new Error("The packaged macOS startup smoke recovery record is invalid.");
  }
  return {
    schemaVersion: 2,
    ownerPid: record.ownerPid as number,
    ownerIdentity: record.ownerIdentity,
    keychainPath: keychainPath as string,
    previousDefault: record.previousDefault as string | null,
    previousSearchList: record.previousSearchList as string[],
    processGroup:
      processGroup === null
        ? null
        : { id: processGroup.id as number, identity: processGroup.identity as string },
  };
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function terminateMacSmokeProcessGroup(processGroupId: number): void {
  if (!isPosixProcessGroupAlive(processGroupId)) return;
  for (const [signal, timeoutMs] of [
    ["SIGTERM", 5_000],
    ["SIGKILL", 2_000],
  ] as const) {
    try {
      process.kill(-processGroupId, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && isPosixProcessGroupAlive(processGroupId)) {
      sleepSync(50);
    }
    if (!isPosixProcessGroupAlive(processGroupId)) return;
  }
  throw new Error(`Could not prove stale packaged process group ${processGroupId} exited.`);
}

function stopMacSmokeRecoveryProcessGroup(
  recovery: MacSmokeKeychainRecovery,
  isProcessAlive: (pid: number) => boolean,
  isProcessGroupAlive: (pid: number) => boolean,
  getProcessIdentity: (pid: number) => string | null,
  terminateProcessGroup: (pid: number) => void,
): void {
  const processGroup = recovery.processGroup;
  if (!processGroup || !isProcessGroupAlive(processGroup.id)) return;
  if (isProcessAlive(processGroup.id)) {
    const currentIdentity = getProcessIdentity(processGroup.id);
    if (!currentIdentity) {
      throw new Error(
        `Could not validate stale packaged process group ${processGroup.id} before recovery.`,
      );
    }
    if (currentIdentity !== processGroup.identity) return;
  }
  terminateProcessGroup(processGroup.id);
  if (isProcessGroupAlive(processGroup.id)) {
    throw new Error(`Stale packaged process group ${processGroup.id} is still running.`);
  }
}

function restoreMacSmokeKeychainRecovery(
  commands: MacSmokeKeychainCommandRunner,
  recovery: MacSmokeKeychainRecovery,
): void {
  const failures: unknown[] = [];
  let referencesRestored = true;
  try {
    commands.run([
      "default-keychain",
      "-d",
      "user",
      "-s",
      ...(recovery.previousDefault ? [recovery.previousDefault] : []),
    ]);
  } catch (error) {
    referencesRestored = false;
    failures.push(error);
  }
  try {
    commands.run(["list-keychains", "-d", "user", "-s", ...recovery.previousSearchList]);
  } catch (error) {
    referencesRestored = false;
    failures.push(error);
  }
  if (referencesRestored && existsSync(recovery.keychainPath)) {
    try {
      commands.run(["delete-keychain", recovery.keychainPath]);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Could not recover the previous macOS smoke Keychain state.",
    );
  }
  rmSync(dirname(recovery.keychainPath), { recursive: true, force: true });
}

function acquireMacSmokeKeychainGuard(
  guardDirectory: string,
  isProcessAlive: (pid: number) => boolean,
  getProcessIdentity: (pid: number) => string | null,
): () => void {
  const ownerIdentity = getProcessIdentity(process.pid);
  if (!ownerIdentity) {
    throw new Error("Could not identify the macOS startup smoke recovery guard owner.");
  }
  const ownerRecord: MacSmokeLockOwner = {
    schemaVersion: 1,
    pid: process.pid,
    identity: ownerIdentity,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidateDirectory = `${guardDirectory}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`;
    try {
      mkdirSync(candidateDirectory, { mode: 0o700 });
      writeFileSync(join(candidateDirectory, "owner"), `${JSON.stringify(ownerRecord)}\n`, {
        mode: 0o600,
      });
      renameSync(candidateDirectory, guardDirectory);
      return () => {
        try {
          const owner = parseMacSmokeLockOwner(readFileSync(join(guardDirectory, "owner"), "utf8"));
          if (owner.pid === process.pid && owner.identity === ownerIdentity) {
            rmSync(guardDirectory, { recursive: true, force: true });
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      rmSync(candidateDirectory, { recursive: true, force: true });
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
      let owner: MacSmokeLockOwner;
      try {
        owner = parseMacSmokeLockOwner(readFileSync(join(guardDirectory, "owner"), "utf8"));
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw readError;
      }
      if (isProcessAlive(owner.pid)) {
        const currentIdentity = getProcessIdentity(owner.pid);
        if (!currentIdentity || currentIdentity === owner.identity) {
          throw new Error(`Another macOS smoke is changing the Keychain lock (pid=${owner.pid}).`);
        }
      }
      const staleDirectory = `${guardDirectory}.stale-${process.pid}-${randomBytes(6).toString("hex")}`;
      try {
        renameSync(guardDirectory, staleDirectory);
        rmSync(staleDirectory, { recursive: true, force: true });
      } catch (renameError) {
        if ((renameError as NodeJS.ErrnoException).code !== "ENOENT") throw renameError;
      }
    }
  }
  throw new Error("Could not acquire the packaged macOS startup smoke recovery guard.");
}

export function acquireMacSmokeKeychainLock(
  commands: MacSmokeKeychainCommandRunner,
  options: AcquireMacSmokeKeychainLockOptions = {},
): MacSmokeKeychainLock {
  const lockDirectory = options.lockDirectory ?? resolveMacSmokeKeychainLockDirectory();
  const isProcessAlive = options.isProcessAlive ?? isLiveProcess;
  const isProcessGroupAlive = options.isProcessGroupAlive ?? isPosixProcessGroupAlive;
  const getProcessIdentity = options.getProcessIdentity ?? readMacSmokeProcessIdentity;
  const terminateProcessGroup = options.terminateProcessGroup ?? terminateMacSmokeProcessGroup;
  const ownerIdentity = getProcessIdentity(process.pid);
  if (!ownerIdentity) {
    throw new Error("Could not identify the packaged macOS startup smoke lock owner.");
  }
  const ownerRecord: MacSmokeLockOwner = {
    schemaVersion: 1,
    pid: process.pid,
    identity: ownerIdentity,
  };
  mkdirSync(dirname(lockDirectory), { recursive: true, mode: 0o700 });
  const ownerPath = join(lockDirectory, "owner");
  const recoveryPath = join(lockDirectory, "recovery.json");
  const releaseGuard = acquireMacSmokeKeychainGuard(
    `${lockDirectory}.guard`,
    isProcessAlive,
    getProcessIdentity,
  );
  try {
    if (existsSync(lockDirectory)) {
      const owner = parseMacSmokeLockOwner(readFileSync(ownerPath, "utf8"));
      if (isProcessAlive(owner.pid)) {
        const currentIdentity = getProcessIdentity(owner.pid);
        if (!currentIdentity || currentIdentity === owner.identity) {
          throw new Error(
            `Another packaged macOS startup smoke is already running (pid=${owner.pid}).`,
          );
        }
      }
      let recovery: MacSmokeKeychainRecovery | null = null;
      try {
        recovery = parseMacSmokeKeychainRecovery(
          readFileSync(recoveryPath, "utf8"),
          dirname(lockDirectory),
        );
      } catch (recoveryError) {
        if ((recoveryError as NodeJS.ErrnoException).code !== "ENOENT") throw recoveryError;
      }
      if (
        recovery &&
        (recovery.ownerPid !== owner.pid || recovery.ownerIdentity !== owner.identity)
      ) {
        throw new Error("The packaged macOS startup smoke recovery owner does not match its lock.");
      }
      if (recovery) {
        stopMacSmokeRecoveryProcessGroup(
          recovery,
          isProcessAlive,
          isProcessGroupAlive,
          getProcessIdentity,
          terminateProcessGroup,
        );
        restoreMacSmokeKeychainRecovery(commands, recovery);
      }
      rmSync(lockDirectory, { recursive: true, force: true });
    }

    const candidateDirectory = `${lockDirectory}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`;
    try {
      mkdirSync(candidateDirectory, { mode: 0o700 });
      writeFileSync(join(candidateDirectory, "owner"), `${JSON.stringify(ownerRecord)}\n`, {
        mode: 0o600,
      });
      renameSync(candidateDirectory, lockDirectory);
    } catch (error) {
      rmSync(candidateDirectory, { recursive: true, force: true });
      throw error;
    }
    return {
      ownerIdentity,
      persistRecovery: (recovery) => {
        if (recovery.ownerPid !== process.pid || recovery.ownerIdentity !== ownerIdentity) {
          throw new Error("The macOS smoke recovery record does not match the lock owner.");
        }
        const temporaryRecoveryPath = join(lockDirectory, `recovery-${process.pid}.tmp`);
        writeFileSync(temporaryRecoveryPath, `${JSON.stringify(recovery)}\n`, { mode: 0o600 });
        renameSync(temporaryRecoveryPath, recoveryPath);
      },
      release: () => {
        try {
          const owner = parseMacSmokeLockOwner(readFileSync(ownerPath, "utf8"));
          if (owner.pid === process.pid && owner.identity === ownerIdentity) {
            rmSync(lockDirectory, { recursive: true, force: true });
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      },
    };
  } finally {
    releaseGuard();
  }
}

/**
 * GitHub's macOS runners do not always have an unlocked default keychain. A
 * clean Chromium profile creates its encryption key during the first window
 * load, which otherwise blocks inside native Keychain authorization without a
 * visible prompt. Give the packaged smoke an isolated, unlocked keychain and
 * restore the runner state after the app exits.
 */
export function createMacSmokeKeychainSession(
  root: string,
  options: PrepareMacSmokeKeychainOptions = {},
): MacSmokeKeychainSession {
  const keychainPath = join(root, "graft-packaged-smoke.keychain-db");
  const password = options.password ?? randomBytes(32).toString("hex");
  const commands = options.commands ?? macSmokeKeychainCommands;
  const keychainLock = (options.acquireLock ?? acquireMacSmokeKeychainLock)(commands);
  let previousDefault: string | undefined;
  let previousSearchList: string[];
  let recovery: MacSmokeKeychainRecovery;
  try {
    previousDefault = parseMacKeychainList(commands.read(["default-keychain", "-d", "user"]))[0];
    previousSearchList = parseMacKeychainList(commands.read(["list-keychains", "-d", "user"]));
    recovery = {
      schemaVersion: 2,
      ownerPid: process.pid,
      ownerIdentity: keychainLock.ownerIdentity,
      keychainPath,
      previousDefault: previousDefault ?? null,
      previousSearchList,
      processGroup: null,
    };
    keychainLock.persistRecovery(recovery);
  } catch (error) {
    try {
      keychainLock.release();
    } catch (releaseError) {
      throw new AggregateError(
        [error, releaseError],
        "Could not inspect the macOS Keychain or release its smoke lock.",
      );
    }
    throw error;
  }
  let created = false;
  let restored = false;
  let restoring = false;
  let lockReleased = false;

  const restore = () => {
    if (restored) return;
    if (restoring) throw new Error("macOS smoke Keychain restoration is already running.");
    restoring = true;
    const failures: unknown[] = [];
    let referencesRestored = true;
    try {
      try {
        commands.run([
          "default-keychain",
          "-d",
          "user",
          "-s",
          ...(previousDefault ? [previousDefault] : []),
        ]);
      } catch (error) {
        referencesRestored = false;
        failures.push(error);
      }
      try {
        commands.run(["list-keychains", "-d", "user", "-s", ...previousSearchList]);
      } catch (error) {
        referencesRestored = false;
        failures.push(error);
      }
      if (created && referencesRestored) {
        try {
          commands.run(["delete-keychain", keychainPath]);
          created = false;
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length === 0 && !lockReleased) {
        try {
          keychainLock.release();
          lockReleased = true;
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length === 0) {
        restored = true;
      } else {
        throw new AggregateError(failures, "Could not restore the macOS smoke Keychain state.");
      }
    } finally {
      restoring = false;
    }
  };

  const prepare = () => {
    try {
      commands.run(["create-keychain", "-p", password, keychainPath]);
      created = true;
      commands.run(["unlock-keychain", "-p", password, keychainPath]);
      commands.run(["set-keychain-settings", "-lut", "21600", keychainPath]);
      commands.run(["list-keychains", "-d", "user", "-s", keychainPath]);
      commands.run(["default-keychain", "-d", "user", "-s", keychainPath]);
    } catch (error) {
      try {
        restore();
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          "Could not prepare or restore the macOS smoke Keychain.",
        );
      }
      throw error;
    }
  };

  const recordProcessGroup = (pid: number, identity: string) => {
    if (!Number.isSafeInteger(pid) || pid <= 0 || identity.length === 0) {
      throw new Error("The packaged macOS startup smoke process group identity is invalid.");
    }
    recovery = { ...recovery, processGroup: { id: pid, identity } };
    keychainLock.persistRecovery(recovery);
  };

  return { prepare, recordProcessGroup, restore };
}

function findFiles(root: string, predicate: (path: string) => boolean): string[] {
  const matches: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const candidate = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(candidate);
      } else if (entry.isFile() && predicate(candidate)) {
        matches.push(candidate);
      }
    }
  }
  return matches.sort((left, right) => left.localeCompare(right));
}

function requireSingleAsset(directory: string, suffix: string): string {
  const matches = readdirSync(directory)
    .map((entry) => join(directory, entry))
    .filter((candidate) => statSync(candidate).isFile() && candidate.endsWith(suffix));
  if (matches.length !== 1) {
    throw new Error(`Expected one ${suffix} release asset, found ${matches.length}.`);
  }
  return matches[0]!;
}

interface LaunchCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly runtime: PackagedRuntime;
}

interface PackagedRuntime {
  readonly executable: string;
  readonly resourcesDirectory: string;
}

interface PackagedDependencySmokeLaunch {
  readonly entry: string;
  readonly executable: string;
  readonly usesElectronNodeMode: boolean;
}

export function resolvePackagedDependencySmokeLaunch(
  runtime: PackagedRuntime,
  fileExists: (path: string) => boolean = existsSync,
): PackagedDependencySmokeLaunch {
  const bundledNode = join(
    runtime.resourcesDirectory,
    GRAFT_MAC_BACKEND_NODE_RUNTIME_RELATIVE_PATH,
  );
  if (fileExists(bundledNode)) {
    return {
      entry: join(
        runtime.resourcesDirectory,
        "app.asar.unpacked",
        "apps/server/dist/runtimeDependencySmoke.mjs",
      ),
      executable: bundledNode,
      usesElectronNodeMode: false,
    };
  }
  return {
    entry: join(
      runtime.resourcesDirectory,
      "app.asar",
      "apps/server/dist/runtimeDependencySmoke.mjs",
    ),
    executable: runtime.executable,
    usesElectronNodeMode: true,
  };
}

function prepareMacLaunch(assetsDirectory: string, extractionRoot: string): LaunchCommand {
  const archive = requireSingleAsset(assetsDirectory, ".zip");
  runCommand("ditto", ["-x", "-k", archive, extractionRoot]);
  const appBundles = readdirSync(extractionRoot).filter((entry) => entry.endsWith(".app"));
  if (appBundles.length !== 1) {
    throw new Error(`Expected one packaged macOS app in ${basename(archive)}.`);
  }
  const appBundle = join(extractionRoot, appBundles[0]!);
  const executables = findFiles(join(appBundle, "Contents", "MacOS"), (candidate) =>
    statSync(candidate).isFile(),
  );
  if (executables.length !== 1) {
    throw new Error(`Expected one macOS main executable, found ${executables.length}.`);
  }
  return {
    command: executables[0]!,
    args: [],
    cwd: appBundle,
    runtime: {
      executable: executables[0]!,
      resourcesDirectory: join(appBundle, "Contents", "Resources"),
    },
  };
}

function prepareLinuxLaunch(assetsDirectory: string, extractionRoot: string): LaunchCommand {
  const collectedAppImage = requireSingleAsset(assetsDirectory, ".AppImage");
  const appImage = join(extractionRoot, basename(collectedAppImage));
  copyFileSync(collectedAppImage, appImage);
  chmodSync(appImage, 0o755);
  runCommand(appImage, ["--appimage-extract"], extractionRoot);
  const appRun = join(extractionRoot, "squashfs-root", "AppRun");
  if (!existsSync(appRun)) {
    throw new Error(`${basename(appImage)} did not extract a runnable AppRun payload.`);
  }
  chmodSync(appRun, 0o755);
  return {
    command: "xvfb-run",
    args: ["-a", appRun, "--no-sandbox", "--disable-gpu"],
    cwd: join(extractionRoot, "squashfs-root"),
    runtime: {
      executable: join(extractionRoot, "squashfs-root", "graft"),
      resourcesDirectory: join(extractionRoot, "squashfs-root", "resources"),
    },
  };
}

function prepareWindowsLaunch(assetsDirectory: string, extractionRoot: string): LaunchCommand {
  const installer = requireSingleAsset(assetsDirectory, ".exe");
  const installerRoot = join(extractionRoot, "installer");
  const applicationRoot = join(extractionRoot, "application");
  mkdirSync(installerRoot, { recursive: true });
  mkdirSync(applicationRoot, { recursive: true });
  runCommand("7z", ["x", "-y", `-o${installerRoot}`, installer]);
  const applicationArchives = findFiles(installerRoot, (candidate) =>
    /[/\\]app-(?:32|64|arm64)\.7z$/i.test(candidate),
  );
  if (applicationArchives.length !== 1) {
    throw new Error(
      `Expected one embedded NSIS application archive, found ${applicationArchives.length}.`,
    );
  }
  runCommand("7z", ["x", "-y", `-o${applicationRoot}`, applicationArchives[0]!]);
  const executables = findFiles(applicationRoot, (candidate) =>
    /[/\\]Graft\.exe$/i.test(candidate),
  );
  if (executables.length !== 1) {
    throw new Error(`Expected one extracted Graft.exe, found ${executables.length}.`);
  }
  return {
    command: executables[0]!,
    args: [],
    cwd: dirname(executables[0]!),
    runtime: {
      executable: executables[0]!,
      resourcesDirectory: join(dirname(executables[0]!), "resources"),
    },
  };
}

export function verifyPackagedRuntimeDependencies(
  runtime: PackagedRuntime,
  isolatedEnvironment: NodeJS.ProcessEnv,
  timeoutMs: number,
): void {
  const launch = resolvePackagedDependencySmokeLaunch(runtime);
  const env: NodeJS.ProcessEnv = { ...isolatedEnvironment };
  if (launch.usesElectronNodeMode) {
    env.ELECTRON_RUN_AS_NODE = "1";
  } else {
    delete env.ELECTRON_RUN_AS_NODE;
  }
  // A workspace loader or NODE_PATH could conceal a missing packaged dependency.
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const result = spawnSync(launch.executable, [launch.entry], {
    cwd: runtime.resourcesDirectory,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? (result.stderr || result.stdout)?.trim();
    throw new Error(
      `Packaged runtime dependency smoke failed (exit=${result.status ?? "unknown"}): ${detail}`,
    );
  }
  console.log("Packaged runtime dependency smoke passed from isolated state.");
}

function prepareLaunch(
  options: PackagedDesktopStartupOptions,
  extractionRoot: string,
): LaunchCommand {
  if (options.platform === "mac") {
    return prepareMacLaunch(options.assetsDirectory, extractionRoot);
  }
  if (options.platform === "linux") {
    return prepareLinuxLaunch(options.assetsDirectory, extractionRoot);
  }
  return prepareWindowsLaunch(options.assetsDirectory, extractionRoot);
}

export function createPackagedDesktopSmokeEnvironment(
  root: string,
  options: Pick<PackagedDesktopStartupOptions, "platform" | "version">,
  inheritedEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...inheritedEnvironment,
    HOME: join(root, "home"),
    USERPROFILE: join(root, "home"),
    APPDATA: join(root, "appdata"),
    LOCALAPPDATA: join(root, "localappdata"),
    XDG_CONFIG_HOME: join(root, "xdg-config"),
    XDG_CACHE_HOME: join(root, "xdg-cache"),
    XDG_DATA_HOME: join(root, "xdg-data"),
    GRAFT_HOME: join(root, "graft-home"),
    GRAFT_DISABLE_AUTO_UPDATE: "1",
    ELECTRON_ENABLE_LOGGING: "1",
  };
  delete env.GRAFT_AUTH_TOKEN;
  delete env.ELECTRON_RUN_AS_NODE;
  for (const path of [
    env.HOME,
    env.APPDATA,
    env.LOCALAPPDATA,
    env.XDG_CONFIG_HOME,
    env.XDG_CACHE_HOME,
    env.XDG_DATA_HOME,
    env.GRAFT_HOME,
  ]) {
    if (path) mkdirSync(path, { recursive: true });
  }
  if (options.platform === "mac") {
    const userDataPath = join(env.HOME!, "Library", "Application Support", "graft-studio-next");
    mkdirSync(userDataPath, { recursive: true });
    // Prevent the packaged app's update-only icon repair from registering this
    // temporary bundle in the runner's normal Launch Services database.
    const launchVersionPath = join(userDataPath, "last-launch-version.json");
    writeFileSync(launchVersionPath, `${JSON.stringify({ version: options.version }, null, 2)}\n`);
  }
  return env;
}

function isPosixProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForProcessTreeExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const childExited = child.exitCode !== null || child.signalCode !== null;
    const groupExited =
      process.platform === "win32" || !child.pid || !isPosixProcessGroupAlive(child.pid);
    if (childExited && groupExited) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  const childExited = child.exitCode !== null || child.signalCode !== null;
  return (
    childExited &&
    (process.platform === "win32" || !child.pid || !isPosixProcessGroupAlive(child.pid))
  );
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (await waitForProcessTreeExit(child, 5_000)) return;
    const detail = result.error?.message ?? `exit ${result.status ?? "unknown"}`;
    throw new Error(`Could not terminate the packaged Windows process tree (${detail}).`);
  }
  if (
    (child.exitCode !== null || child.signalCode !== null) &&
    !isPosixProcessGroupAlive(child.pid)
  ) {
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  if (await waitForProcessTreeExit(child, 5_000)) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
  if (!(await waitForProcessTreeExit(child, 2_000))) {
    throw new Error(`Could not prove the packaged process group ${child.pid} exited.`);
  }
}

function hasStartupProof(logPath: string): boolean {
  try {
    const log = readFileSync(logPath, "utf8");
    return (
      log.includes("app ready") &&
      log.includes("bootstrap main window created") &&
      log.includes("bootstrap backend ready source=")
    );
  } catch {
    return false;
  }
}

const STARTUP_DIAGNOSTIC_TAIL_LENGTH = 16_384;
const MAC_BACKEND_SAMPLE_LENGTH = 65_536;

export function readPackagedStartupLogTails(logDirectory: string): string {
  return ["desktop-main.log", "server-child.log"]
    .map((name) => {
      try {
        const tail = readFileSync(join(logDirectory, name), "utf8").slice(
          -STARTUP_DIAGNOSTIC_TAIL_LENGTH,
        );
        return `${name}:\n${tail}`;
      } catch {
        return `${name}: unavailable`;
      }
    })
    .join("\n");
}

export function retainMacBackendSampleCallGraph(output: string): string {
  const binaryImagesIndex = output.indexOf("Binary Images:");
  const callGraph = binaryImagesIndex >= 0 ? output.slice(0, binaryImagesIndex) : output;
  return callGraph.trim().slice(0, MAC_BACKEND_SAMPLE_LENGTH);
}

export function readLatestPackagedBackendPort(desktopLog: string): number | null {
  const matches = [...desktopLog.matchAll(/resolved backend endpoint port=(\d+)/gu)];
  const rawPort = matches.at(-1)?.[1];
  if (!rawPort) return null;
  const port = Number(rawPort);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
}

function readMacProcessSample(pid: number, label: string): string {
  const result = spawnSync("sample", [String(pid), "3", "1"], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10_000,
  });
  const output = retainMacBackendSampleCallGraph(
    result.stdout || result.stderr || result.error?.message || "No sample output.",
  );
  return `Packaged macOS ${label} sample (pid=${pid}):\n${output}`;
}

function readMacBackendSample(logDirectory: string): string {
  try {
    const serverLog = readFileSync(join(logDirectory, "server-child.log"), "utf8");
    const sessions = [...serverLog.matchAll(/APP SESSION START[^\n]*\bpid=(\d+)\b/gu)];
    const pid = sessions.at(-1)?.[1];
    if (!pid) return "Packaged macOS backend sample: backend PID unavailable.";
    return readMacProcessSample(Number(pid), "backend");
  } catch (error) {
    return `Packaged macOS backend sample failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function readMacBackendHealth(logDirectory: string): Promise<string> {
  try {
    const desktopLog = readFileSync(join(logDirectory, "desktop-main.log"), "utf8");
    const port = readLatestPackagedBackendPort(desktopLog);
    if (port === null) return "Packaged macOS backend health: backend port unavailable.";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: controller.signal,
      });
      const body = (await response.text()).slice(0, 4_096);
      return `Packaged macOS backend health (port=${port}): status=${response.status} body=${body}`;
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return `Packaged macOS backend health failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function resolveNativePackagedDesktopPlatform(
  platform: NodeJS.Platform,
): PackagedDesktopPlatform {
  if (platform === "darwin") return "mac";
  if (platform === "win32") return "win";
  return "linux";
}

export async function verifyPackagedDesktopStartup(
  options: PackagedDesktopStartupOptions,
): Promise<void> {
  const nativePlatform = resolveNativePackagedDesktopPlatform(process.platform);
  if (nativePlatform !== options.platform) {
    throw new Error(
      `Packaged ${options.platform} startup smoke must run on its native host, not ${process.platform}.`,
    );
  }
  const temporaryRoot = mkdtempSync(join(tmpdir(), `graft-packaged-smoke-${options.platform}-`));
  const extractionRoot = join(temporaryRoot, "payload");
  mkdirSync(extractionRoot, { recursive: true });
  let macKeychainRoot: string | null = null;
  if (options.platform === "mac") {
    const macKeychainStateDirectory = resolveMacSmokeKeychainStateDirectory();
    mkdirSync(macKeychainStateDirectory, { recursive: true, mode: 0o700 });
    macKeychainRoot = mkdtempSync(join(macKeychainStateDirectory, "keychain-"));
  }

  let child: ChildProcess | null = null;
  let logDirectory: string | null = null;
  let outputTail = "";
  let macKeychainSession: MacSmokeKeychainSession | null = null;
  let interruptedSignal: NodeJS.Signals | null = null;
  const handleSigint = () => {
    interruptedSignal ??= "SIGINT";
  };
  const handleSigterm = () => {
    interruptedSignal ??= "SIGTERM";
  };
  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);

  let operationError: unknown;
  try {
    const launch = prepareLaunch(options, extractionRoot);
    const env = createPackagedDesktopSmokeEnvironment(join(temporaryRoot, "state"), options);
    verifyPackagedRuntimeDependencies(launch.runtime, env, options.timeoutMs);
    if (macKeychainRoot) {
      macKeychainSession = createMacSmokeKeychainSession(macKeychainRoot);
      macKeychainSession.prepare();
    }
    if (interruptedSignal)
      throw new Error(`Packaged startup smoke interrupted by ${interruptedSignal}.`);
    logDirectory = join(env.GRAFT_HOME!, "userdata", "logs");
    const logPath = join(logDirectory, "desktop-main.log");
    const childOutcome: {
      exited: { code: number | null; signal: NodeJS.Signals | null } | null;
      launchError: Error | null;
    } = { exited: null, launchError: null };
    child = spawn(launch.command, [...launch.args], {
      cwd: launch.cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.once("exit", (code, signal) => {
      childOutcome.exited = { code, signal };
    });
    child.once("error", (error) => {
      childOutcome.launchError = error;
    });
    if (macKeychainSession && child.pid) {
      const processIdentity = readMacSmokeProcessIdentity(child.pid);
      if (!processIdentity) {
        throw new Error(`Could not identify packaged process group ${child.pid}.`);
      }
      macKeychainSession.recordProcessGroup(child.pid, processIdentity);
    }
    const retainOutputTail = (chunk: Buffer) => {
      outputTail = (outputTail + chunk.toString("utf8")).slice(-STARTUP_DIAGNOSTIC_TAIL_LENGTH);
    };
    child.stdout?.on("data", retainOutputTail);
    child.stderr?.on("data", retainOutputTail);

    const deadline = Date.now() + options.timeoutMs;
    let startupProven = false;
    while (Date.now() < deadline) {
      if (interruptedSignal) {
        throw new Error(`Packaged startup smoke interrupted by ${interruptedSignal}.`);
      }
      if (hasStartupProof(logPath)) {
        console.log(
          `Packaged ${options.platform}/${options.arch} startup smoke passed from isolated state.`,
        );
        startupProven = true;
        break;
      }
      if (childOutcome.launchError) {
        throw new Error(`Packaged app could not start: ${childOutcome.launchError.message}`);
      }
      if (childOutcome.exited) {
        throw new Error(
          `Packaged app exited before startup proof (code=${childOutcome.exited.code ?? "null"}, signal=${childOutcome.exited.signal ?? "null"}).`,
        );
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
    if (!startupProven) {
      throw new Error(`Packaged startup proof timed out after ${options.timeoutMs}ms.`);
    }
  } catch (error) {
    operationError = error;
    if (logDirectory) {
      console.error(readPackagedStartupLogTails(logDirectory));
      console.error(`Packaged process output tail:\n${outputTail || "No output captured."}`);
      if (process.platform === "darwin") {
        console.error(await readMacBackendHealth(logDirectory));
        console.error(readMacBackendSample(logDirectory));
        if (child?.pid) {
          console.error(readMacProcessSample(child.pid, "desktop main"));
        }
      }
    }
  }

  const cleanupErrors: unknown[] = [];
  let processTreeStopped = child === null;
  if (child) {
    try {
      await terminateProcessTree(child);
      processTreeStopped = true;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  let macKeychainRestored = macKeychainSession === null;
  if (macKeychainSession && processTreeStopped) {
    let finalRestoreError: unknown;
    for (let attempt = 0; attempt < 3 && !macKeychainRestored; attempt += 1) {
      try {
        macKeychainSession.restore();
        macKeychainRestored = true;
      } catch (error) {
        finalRestoreError = error;
        if (attempt < 2) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
        }
      }
    }
    if (!macKeychainRestored) {
      cleanupErrors.push(finalRestoreError);
      console.error(finalRestoreError);
    }
  }
  if (macKeychainRoot && macKeychainRestored) {
    try {
      rmSync(macKeychainRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (processTreeStopped) {
    try {
      rmSync(temporaryRoot, {
        recursive: true,
        force: true,
        maxRetries: process.platform === "win32" ? 20 : 0,
        retryDelay: process.platform === "win32" ? 250 : 100,
      });
    } catch (error) {
      if (
        process.platform === "win32" &&
        error instanceof Error &&
        "code" in error &&
        error.code === "EPERM"
      ) {
        console.warn(
          `Could not remove Windows smoke temp directory; leaving it for runner cleanup: ${temporaryRoot}`,
        );
      } else {
        cleanupErrors.push(error);
      }
    }
  }
  await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
  process.off("SIGINT", handleSigint);
  process.off("SIGTERM", handleSigterm);

  if (!operationError && interruptedSignal) {
    operationError = new Error(`Packaged startup smoke interrupted by ${interruptedSignal}.`);
  }

  if (operationError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [operationError, ...cleanupErrors],
      "Packaged startup verification and cleanup failed.",
    );
  }
  if (operationError) throw operationError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "Packaged startup cleanup failed.");
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await verifyPackagedDesktopStartup(parsePackagedDesktopStartupArgs(process.argv.slice(2)));
}
