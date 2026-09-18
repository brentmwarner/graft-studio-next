import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireMacSmokeKeychainLock,
  createMacPackagedLaunchGate,
  createMacSmokeKeychainSession,
  createPackagedDesktopSmokeEnvironment,
  parseMacKeychainList,
  parsePackagedDesktopStartupArgs,
  readLatestPackagedBackendPort,
  readPackagedStartupLogTails,
  redactMacKeychainCommandArgs,
  retainMacBackendSampleCallGraph,
  resolveMacSmokeKeychainLockDirectory,
  resolveMacSmokeKeychainStateDirectory,
  resolvePackagedDependencySmokeLaunch,
  resolveNativePackagedDesktopPlatform,
  verifyPackagedRuntimeDependencies,
} from "./verify-packaged-desktop-startup.ts";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("packaged desktop startup verification", () => {
  it("stores macOS Keychain coordination under a stable user-global path", () => {
    expect(resolveMacSmokeKeychainStateDirectory("/Users/runner")).toBe(
      "/Users/runner/.graft/release-smoke/macos-keychain",
    );
    expect(resolveMacSmokeKeychainLockDirectory("/Users/runner")).toBe(
      "/Users/runner/.graft/release-smoke/macos-keychain/state.lock",
    );
  });

  it("keeps the packaged macOS app behind a gate until recovery is durable", async () => {
    const root = mkdtempSync(join(tmpdir(), "graft-smoke-launch-gate-test-"));
    temporaryRoots.push(root);
    const gatePath = join(root, "launch-ready");
    const outputPath = join(root, "launched");
    const gate = createMacPackagedLaunchGate(
      "/bin/sh",
      ["-c", 'printf launched > "$1"', "graft-gate-target", outputPath],
      gatePath,
    );
    const child = spawn(gate.command, [...gate.args], { stdio: "ignore" });
    const childExit = new Promise<void>((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", (code, signal) => {
        if (code === 0) resolveExit();
        else rejectExit(new Error(`Launch gate exited with code=${code}, signal=${signal}.`));
      });
    });

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    expect(existsSync(outputPath)).toBe(false);

    gate.open();
    await childExit;
    expect(readFileSync(outputPath, "utf8")).toBe("launched");
  });

  it("parses quoted macOS keychain command output", () => {
    expect(
      parseMacKeychainList(
        '    "/Users/runner/Library/Keychains/login.keychain-db"\n    "/tmp/Graft \\\"Smoke\\\".keychain-db"\n',
      ),
    ).toEqual([
      "/Users/runner/Library/Keychains/login.keychain-db",
      '/tmp/Graft "Smoke".keychain-db',
    ]);
  });

  it("redacts macOS keychain passwords from command diagnostics", () => {
    expect(
      redactMacKeychainCommandArgs([
        "create-keychain",
        "-p",
        "super-secret",
        "/tmp/graft-smoke.keychain-db",
      ]),
    ).toBe("create-keychain -p <redacted> /tmp/graft-smoke.keychain-db");
  });

  it("restores an isolated macOS smoke keychain and releases its lock", () => {
    const commands: string[][] = [];
    let persistedRecovery: unknown;
    let lockReleased = false;
    const session = createMacSmokeKeychainSession("/tmp/graft-smoke", {
      commands: {
        read: (args) =>
          args[0] === "default-keychain"
            ? '"/Users/runner/login.keychain-db"\n'
            : '"/Users/runner/login.keychain-db"\n"/Library/Keychains/System.keychain"\n',
        run: (args) => commands.push([...args]),
      },
      password: "test-password",
      acquireLock: () => ({
        ownerIdentity: "test-owner",
        persistRecovery: (recovery) => {
          persistedRecovery = recovery;
        },
        release: () => {
          lockReleased = true;
        },
      }),
    });

    session.prepare();
    session.recordProcessGroup(9_001, "test-process-group");
    session.restore();

    expect(persistedRecovery).toMatchObject({
      schemaVersion: 2,
      ownerPid: process.pid,
      ownerIdentity: "test-owner",
      keychainPath: "/tmp/graft-smoke/graft-packaged-smoke.keychain-db",
      previousDefault: "/Users/runner/login.keychain-db",
      previousSearchList: ["/Users/runner/login.keychain-db", "/Library/Keychains/System.keychain"],
      processGroup: { id: 9_001, identity: "test-process-group" },
    });
    expect(commands).toEqual([
      [
        "create-keychain",
        "-p",
        "test-password",
        "/tmp/graft-smoke/graft-packaged-smoke.keychain-db",
      ],
      [
        "unlock-keychain",
        "-p",
        "test-password",
        "/tmp/graft-smoke/graft-packaged-smoke.keychain-db",
      ],
      [
        "set-keychain-settings",
        "-lut",
        "21600",
        "/tmp/graft-smoke/graft-packaged-smoke.keychain-db",
      ],
      ["list-keychains", "-d", "user", "-s", "/tmp/graft-smoke/graft-packaged-smoke.keychain-db"],
      ["default-keychain", "-d", "user", "-s", "/tmp/graft-smoke/graft-packaged-smoke.keychain-db"],
      ["default-keychain", "-d", "user", "-s", "/Users/runner/login.keychain-db"],
      [
        "list-keychains",
        "-d",
        "user",
        "-s",
        "/Users/runner/login.keychain-db",
        "/Library/Keychains/System.keychain",
      ],
      ["delete-keychain", "/tmp/graft-smoke/graft-packaged-smoke.keychain-db"],
    ]);
    expect(lockReleased).toBe(true);
  });

  it("deletes the temporary keychain when setup fails after creation", () => {
    const commands: string[][] = [];
    const session = createMacSmokeKeychainSession("/tmp/graft-smoke", {
      commands: {
        read: (args) =>
          args[0] === "default-keychain" ? '"/Users/runner/login.keychain-db"\n' : "",
        run: (args) => {
          commands.push([...args]);
          if (args[0] === "unlock-keychain") throw new Error("unlock failed");
        },
      },
      password: "test-password",
      acquireLock: () => ({
        ownerIdentity: "test-owner",
        persistRecovery: () => undefined,
        release: () => undefined,
      }),
    });

    expect(() => session.prepare()).toThrow("unlock failed");

    expect(commands).toContainEqual([
      "default-keychain",
      "-d",
      "user",
      "-s",
      "/Users/runner/login.keychain-db",
    ]);
    expect(commands).toContainEqual(["list-keychains", "-d", "user", "-s"]);
    expect(commands).toContainEqual([
      "delete-keychain",
      "/tmp/graft-smoke/graft-packaged-smoke.keychain-db",
    ]);
  });

  it("restores every keychain reference after setup fails and preserves a referenced keychain", () => {
    const commands: string[][] = [];
    let defaultRestoreAttempts = 0;
    let lockReleased = false;
    const session = createMacSmokeKeychainSession("/tmp/graft-smoke", {
      commands: {
        read: () => "",
        run: (args) => {
          commands.push([...args]);
          if (args[0] === "unlock-keychain") throw new Error("unlock failed");
          if (args[0] === "default-keychain" && args.at(-1) === "-s") {
            defaultRestoreAttempts += 1;
            if (defaultRestoreAttempts === 1) throw new Error("default restore failed");
          }
        },
      },
      password: "test-password",
      acquireLock: () => ({
        ownerIdentity: "test-owner",
        persistRecovery: () => undefined,
        release: () => {
          lockReleased = true;
        },
      }),
    });

    expect(() => session.prepare()).toThrow(
      "Could not prepare or restore the macOS smoke Keychain",
    );

    expect(commands).toContainEqual(["default-keychain", "-d", "user", "-s"]);
    expect(commands).toContainEqual(["list-keychains", "-d", "user", "-s"]);
    expect(commands.some(([command]) => command === "delete-keychain")).toBe(false);
    expect(lockReleased).toBe(false);

    expect(() => session.restore()).not.toThrow();
    expect(commands).toContainEqual([
      "delete-keychain",
      "/tmp/graft-smoke/graft-packaged-smoke.keychain-db",
    ]);
    expect(lockReleased).toBe(true);
  });

  it("retries a partial keychain restoration before deleting the keychain or releasing the lock", () => {
    const commands: string[][] = [];
    let defaultRestoreAttempts = 0;
    let lockReleased = false;
    const session = createMacSmokeKeychainSession("/tmp/graft-smoke", {
      commands: {
        read: (args) =>
          args[0] === "default-keychain"
            ? '"/Users/runner/login.keychain-db"\n'
            : '"/Users/runner/login.keychain-db"\n',
        run: (args) => {
          commands.push([...args]);
          if (args[0] === "default-keychain" && args.at(-1) === "/Users/runner/login.keychain-db") {
            defaultRestoreAttempts += 1;
            if (defaultRestoreAttempts === 1) throw new Error("transient restore failure");
          }
        },
      },
      password: "test-password",
      acquireLock: () => ({
        ownerIdentity: "test-owner",
        persistRecovery: () => undefined,
        release: () => {
          lockReleased = true;
        },
      }),
    });
    session.prepare();

    expect(() => session.restore()).toThrow("Could not restore the macOS smoke Keychain state");
    expect(lockReleased).toBe(false);
    expect(commands.some(([command]) => command === "delete-keychain")).toBe(false);

    expect(() => session.restore()).not.toThrow();
    expect(defaultRestoreAttempts).toBe(2);
    expect(commands).toContainEqual([
      "delete-keychain",
      "/tmp/graft-smoke/graft-packaged-smoke.keychain-db",
    ]);
    expect(lockReleased).toBe(true);
  });

  it("recovers a stale macOS smoke lock from its persisted keychain snapshot", () => {
    const lockRoot = mkdtempSync(join(tmpdir(), "graft-smoke-lock-test-"));
    temporaryRoots.push(lockRoot);
    const lockDirectory = join(lockRoot, "keychain.lock");
    mkdirSync(lockDirectory);
    writeFileSync(
      join(lockDirectory, "owner"),
      JSON.stringify({ schemaVersion: 1, pid: 4242, identity: "stale-owner" }),
    );

    const keychainRoot = mkdtempSync(join(lockRoot, "keychain-"));
    const keychainPath = join(keychainRoot, "graft-packaged-smoke.keychain-db");
    writeFileSync(keychainPath, "temporary keychain");
    writeFileSync(
      join(lockDirectory, "recovery.json"),
      JSON.stringify({
        schemaVersion: 2,
        ownerPid: 4242,
        ownerIdentity: "stale-owner",
        keychainPath,
        previousDefault: "/Users/runner/login.keychain-db",
        previousSearchList: [
          "/Users/runner/login.keychain-db",
          "/Library/Keychains/System.keychain",
        ],
        processGroup: { id: 5252, identity: "stale-process-group" },
      }),
    );

    const commands: string[][] = [];
    const terminatedProcessGroups: number[] = [];
    let processGroupAlive = true;
    const lock = acquireMacSmokeKeychainLock(
      { read: () => "", run: (args) => commands.push([...args]) },
      {
        lockDirectory,
        isProcessAlive: () => false,
        isProcessGroupAlive: () => processGroupAlive,
        getProcessIdentity: (pid) => (pid === process.pid ? "current-owner" : null),
        terminateProcessGroup: (pid) => {
          terminatedProcessGroups.push(pid);
          processGroupAlive = false;
        },
      },
    );

    expect(terminatedProcessGroups).toEqual([5252]);
    expect(commands).toEqual([
      ["default-keychain", "-d", "user", "-s", "/Users/runner/login.keychain-db"],
      [
        "list-keychains",
        "-d",
        "user",
        "-s",
        "/Users/runner/login.keychain-db",
        "/Library/Keychains/System.keychain",
      ],
      ["delete-keychain", keychainPath],
    ]);
    expect(existsSync(keychainRoot)).toBe(false);
    expect(JSON.parse(readFileSync(join(lockDirectory, "owner"), "utf8"))).toEqual({
      schemaVersion: 1,
      pid: process.pid,
      identity: "current-owner",
    });

    lock.release();
    expect(existsSync(lockDirectory)).toBe(false);
  });

  it("refuses to recover a macOS smoke lock while its owner is alive", () => {
    const lockRoot = mkdtempSync(join(tmpdir(), "graft-smoke-live-lock-test-"));
    temporaryRoots.push(lockRoot);
    const lockDirectory = join(lockRoot, "keychain.lock");
    mkdirSync(lockDirectory);
    writeFileSync(
      join(lockDirectory, "owner"),
      JSON.stringify({ schemaVersion: 1, pid: 4242, identity: "live-owner" }),
    );

    expect(() =>
      acquireMacSmokeKeychainLock(
        { read: () => "", run: () => undefined },
        {
          lockDirectory,
          isProcessAlive: () => true,
          getProcessIdentity: (pid) => (pid === process.pid ? "current-owner" : "live-owner"),
        },
      ),
    ).toThrow("Another packaged macOS startup smoke is already running (pid=4242)");
    expect(existsSync(lockDirectory)).toBe(true);
  });

  it("rejects the POSIX all-process sentinel in a recovery process group", () => {
    const lockRoot = mkdtempSync(join(tmpdir(), "graft-smoke-invalid-group-test-"));
    temporaryRoots.push(lockRoot);
    const lockDirectory = join(lockRoot, "keychain.lock");
    mkdirSync(lockDirectory);
    writeFileSync(
      join(lockDirectory, "owner"),
      JSON.stringify({ schemaVersion: 1, pid: 4242, identity: "stale-owner" }),
    );
    const keychainRoot = mkdtempSync(join(lockRoot, "keychain-"));
    const keychainPath = join(keychainRoot, "graft-packaged-smoke.keychain-db");
    writeFileSync(keychainPath, "temporary keychain");
    writeFileSync(
      join(lockDirectory, "recovery.json"),
      JSON.stringify({
        schemaVersion: 2,
        ownerPid: 4242,
        ownerIdentity: "stale-owner",
        keychainPath,
        previousDefault: null,
        previousSearchList: [],
        processGroup: { id: 1, identity: "invalid-process-group" },
      }),
    );

    expect(() =>
      acquireMacSmokeKeychainLock(
        { read: () => "", run: () => undefined },
        {
          lockDirectory,
          isProcessAlive: () => false,
          getProcessIdentity: () => "current-owner",
        },
      ),
    ).toThrow("recovery record is invalid");
    expect(existsSync(keychainRoot)).toBe(true);
  });

  it("recovers after owner PID reuse without terminating a reused process group", () => {
    const lockRoot = mkdtempSync(join(tmpdir(), "graft-smoke-reused-pid-test-"));
    temporaryRoots.push(lockRoot);
    const lockDirectory = join(lockRoot, "keychain.lock");
    mkdirSync(lockDirectory);
    writeFileSync(
      join(lockDirectory, "owner"),
      JSON.stringify({ schemaVersion: 1, pid: 4242, identity: "old-owner" }),
    );
    const keychainRoot = mkdtempSync(join(lockRoot, "keychain-"));
    const keychainPath = join(keychainRoot, "graft-packaged-smoke.keychain-db");
    writeFileSync(keychainPath, "temporary keychain");
    writeFileSync(
      join(lockDirectory, "recovery.json"),
      JSON.stringify({
        schemaVersion: 2,
        ownerPid: 4242,
        ownerIdentity: "old-owner",
        keychainPath,
        previousDefault: null,
        previousSearchList: [],
        processGroup: { id: 5252, identity: "old-process-group" },
      }),
    );

    const terminatedProcessGroups: number[] = [];
    const lock = acquireMacSmokeKeychainLock(
      { read: () => "", run: () => undefined },
      {
        lockDirectory,
        isProcessAlive: (pid) => pid === 4242 || pid === 5252,
        isProcessGroupAlive: () => true,
        getProcessIdentity: (pid) => {
          if (pid === process.pid) return "current-owner";
          if (pid === 4242) return "reused-owner";
          return "reused-process-group";
        },
        terminateProcessGroup: (pid) => terminatedProcessGroups.push(pid),
      },
    );

    expect(terminatedProcessGroups).toEqual([]);
    expect(existsSync(keychainRoot)).toBe(false);
    lock.release();
  });

  it("retains bounded failure diagnostics even when a startup log is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "graft-startup-diagnostics-test-"));
    temporaryRoots.push(root);
    writeFileSync(join(root, "desktop-main.log"), "old entry" + "x".repeat(20_000) + "app ready");

    const diagnostics = readPackagedStartupLogTails(root);
    expect(diagnostics).toContain("app ready");
    expect(diagnostics).not.toContain("old entry");
    expect(diagnostics).toContain("server-child.log: unavailable");
    expect(diagnostics.length).toBeLessThan(16_500);
  });

  it("retains the macOS process call graph and removes the binary image list", () => {
    const callGraph = "Call graph:\nnode::sqlite";
    const diagnostics = retainMacBackendSampleCallGraph(
      `Sampling process 123\n${callGraph}\nBinary Images:\n${"library".repeat(10_000)}`,
    );

    expect(diagnostics).toContain("Sampling process 123");
    expect(diagnostics).toContain("Call graph:");
    expect(diagnostics).not.toContain("Binary Images:");
  });

  it("bounds a macOS process call graph without discarding its beginning", () => {
    const diagnostics = retainMacBackendSampleCallGraph(
      `Sampling process 123\nCall graph:\n${"node::sqlite".repeat(10_000)}`,
    );

    expect(diagnostics).toMatch(/^Sampling process 123\nCall graph:/u);
    expect(diagnostics.length).toBeLessThanOrEqual(65_536);
  });

  it("reads the latest valid packaged backend port from the desktop log", () => {
    expect(
      readLatestPackagedBackendPort(
        "bootstrap resolved backend endpoint port=41001\nrestart resolved backend endpoint port=42002",
      ),
    ).toBe(42_002);
    expect(readLatestPackagedBackendPort("resolved backend endpoint port=99999")).toBeNull();
  });

  it("parses a bounded native payload request", () => {
    expect(
      parsePackagedDesktopStartupArgs([
        "--assets-dir",
        "./release-publish",
        "--platform",
        "linux",
        "--arch",
        "x64",
        "--version",
        "1.2.3",
      ]),
    ).toEqual({
      assetsDirectory: expect.stringMatching(/release-publish$/),
      platform: "linux",
      arch: "x64",
      version: "1.2.3",
      timeoutMs: 60_000,
    });

    expect(() =>
      parsePackagedDesktopStartupArgs([
        "--assets-dir",
        "./release-publish",
        "--platform",
        "linux",
        "--arch",
        "x64",
        "--version",
        "1.2.3",
        "--timeout-ms",
        "4999",
      ]),
    ).toThrow("--timeout-ms must be an integer between 5000 and 180000");
  });

  it("isolates user state and removes inherited runtime authority", () => {
    const root = mkdtempSync(join(tmpdir(), "graft-packaged-smoke-env-test-"));
    temporaryRoots.push(root);

    const env = createPackagedDesktopSmokeEnvironment(
      root,
      { platform: "linux", version: "1.2.3" },
      {
        PATH: process.env.PATH,
        GRAFT_AUTH_TOKEN: "must-not-leak",
        GRAFT_TRACE_SQLITE_STARTUP: "0",
        ELECTRON_RUN_AS_NODE: "1",
      },
    );

    expect(env.GRAFT_AUTH_TOKEN).toBeUndefined();
    expect(env.GRAFT_TRACE_SQLITE_STARTUP).toBe("0");
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    for (const name of [
      "HOME",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "XDG_CONFIG_HOME",
      "XDG_CACHE_HOME",
      "XDG_DATA_HOME",
      "GRAFT_HOME",
    ] as const) {
      expect(env[name]?.startsWith(root)).toBe(true);
      expect(existsSync(env[name]!)).toBe(true);
    }
  });

  it("maps Node host platforms to release platform names", () => {
    expect(resolveNativePackagedDesktopPlatform("darwin")).toBe("mac");
    expect(resolveNativePackagedDesktopPlatform("win32")).toBe("win");
    expect(resolveNativePackagedDesktopPlatform("linux")).toBe("linux");
  });

  it("uses the bundled Node runtime with the physical unpacked server entry", () => {
    const root = join("root", "Resources");
    const bundledNode = join(root, "node-runtime", "node");

    expect(
      resolvePackagedDependencySmokeLaunch(
        { executable: join("root", "MacOS", "Graft"), resourcesDirectory: root },
        (candidate) => candidate === bundledNode,
      ),
    ).toEqual({
      entry: join(root, "app.asar.unpacked", "apps/server/dist/runtimeDependencySmoke.mjs"),
      executable: bundledNode,
      usesElectronNodeMode: false,
    });
  });

  it("rejects a missing packaged peer even when the development tree provides it", () => {
    const root = mkdtempSync(join(tmpdir(), "graft-runtime-deps-test-"));
    temporaryRoots.push(root);
    const app = join(root, "app.asar");
    const dist = join(app, "apps/server/dist");
    const sdk = join(app, "node_modules/@agentclientprotocol/sdk");
    const developmentModules = join(root, "development/node_modules");
    const writeZod = (modules: string) => {
      const directory = join(modules, "zod");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "package.json"), '{"type":"module","exports":"./index.js"}');
      writeFileSync(join(directory, "index.js"), 'export const version = "test";');
    };
    mkdirSync(dist, { recursive: true });
    mkdirSync(sdk, { recursive: true });
    writeFileSync(
      join(dist, "runtimeDependencySmoke.mjs"),
      'await import("@agentclientprotocol/sdk");',
    );
    writeFileSync(join(sdk, "package.json"), '{"type":"module","exports":"./index.js"}');
    writeFileSync(join(sdk, "index.js"), 'export { version } from "zod";');
    writeZod(developmentModules);

    const runtime = { executable: process.execPath, resourcesDirectory: root };
    const env = {
      ...process.env,
      NODE_PATH: developmentModules,
      NODE_OPTIONS: "--invalid-development-node-option",
    };
    expect(() => verifyPackagedRuntimeDependencies(runtime, env, 5_000)).toThrow(
      /Cannot find package 'zod'/,
    );

    writeZod(join(app, "node_modules"));
    expect(() => verifyPackagedRuntimeDependencies(runtime, env, 5_000)).not.toThrow();
  });

  it("bounds a runtime import that never finishes", () => {
    const root = mkdtempSync(join(tmpdir(), "graft-runtime-timeout-test-"));
    temporaryRoots.push(root);
    const dist = join(root, "app.asar/apps/server/dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "runtimeDependencySmoke.mjs"), "setInterval(() => {}, 1000);");

    expect(() =>
      verifyPackagedRuntimeDependencies(
        { executable: process.execPath, resourcesDirectory: root },
        process.env,
        200,
      ),
    ).toThrow(/ETIMEDOUT/);
  });
});
