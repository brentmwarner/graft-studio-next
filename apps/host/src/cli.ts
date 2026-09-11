import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  GRAFT_DESKTOP_ENDPOINTS,
  GRAFT_DESKTOP_PROTOCOL_VERSION,
  GRAFT_HOST_VERSION,
  GraftDesktopBootstrapResponseSchema,
  GraftDesktopHealthSchema,
  type GraftDesktopBootstrapResponse,
  type GraftDesktopHealth,
} from "@graft/desktop-contract";
import {
  OccupancyStore,
  diagnoseHostPlatform,
  requireSupportedHostPlatform,
} from "@graft/occupancy";

import {
  readDaemonState,
  removeDaemonState,
  writeDaemonState,
  type GraftHostDaemonState,
} from "./daemonState";
import {
  defaultEnvironmentLabel,
  defaultGraftHostDataRoot,
  resolveGraftHostPaths,
} from "./hostPaths";

type CommandName =
  | "serve"
  | "bootstrap"
  | "diagnostics"
  | "self-test"
  | "version"
  | "help";

export interface ParsedHostArguments {
  command: CommandName;
  dataRoot: string;
  environmentLabel: string;
  port: number;
  json: boolean;
  allowUnsupportedPlatform: boolean;
}

function usage(): string {
  return [
    "Usage: graft-host <command> [options]",
    "",
    "Commands:",
    "  serve        Run the loopback-only host daemon",
    "  bootstrap    Start the daemon if needed and issue one enrollment token",
    "  diagnostics  Report platform, storage, daemon, and occupancy status",
    "  self-test    Exercise health and enrollment without a display server",
    "  version      Print the daemon version",
    "",
    "Options:",
    "  --data-dir <path>            Override the host data directory",
    "  --environment-label <label> Override the machine label",
    "  --port <port>                Loopback port; 0 selects an available port",
    "  --json                       Emit structured diagnostics",
    "  --allow-unsupported-platform Skip the Linux x64 glibc requirement",
  ].join("\n");
}

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return port;
}

function requireValue(values: string[], index: number, name: string): string {
  const value = values[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

export function parseHostArguments(values: string[]): ParsedHostArguments {
  const commandValue = values[0] ?? "help";
  const commands = new Set<CommandName>([
    "serve",
    "bootstrap",
    "diagnostics",
    "self-test",
    "version",
    "help",
  ]);
  if (!commands.has(commandValue as CommandName)) {
    throw new Error(`Unknown graft-host command: ${commandValue}`);
  }
  const parsed: ParsedHostArguments = {
    command: commandValue as CommandName,
    dataRoot: defaultGraftHostDataRoot(),
    environmentLabel: defaultEnvironmentLabel(),
    port: 0,
    json: false,
    allowUnsupportedPlatform: false,
  };
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--data-dir") {
      parsed.dataRoot = resolve(requireValue(values, index, value));
      index += 1;
    } else if (value === "--environment-label") {
      parsed.environmentLabel = requireValue(values, index, value);
      index += 1;
    } else if (value === "--port") {
      parsed.port = parsePort(requireValue(values, index, value));
      index += 1;
    } else if (value === "--json") {
      parsed.json = true;
    } else if (value === "--allow-unsupported-platform") {
      parsed.allowUnsupportedPlatform = true;
    } else {
      throw new Error(`Unknown graft-host option: ${value}`);
    }
  }
  return parsed;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  const port = address && typeof address !== "string" ? address.port : 0;
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
  if (port === 0) throw new Error("Could not reserve a loopback port");
  return port;
}

async function fetchHealth(port: number): Promise<GraftDesktopHealth | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${GRAFT_DESKTOP_ENDPOINTS.health}`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return null;
    return GraftDesktopHealthSchema.parse(await response.json());
  } catch {
    return null;
  }
}

async function currentDaemon(
  statePath: string,
): Promise<{ state: GraftHostDaemonState; health: GraftDesktopHealth } | null> {
  const state = readDaemonState(statePath);
  if (!state) return null;
  const health = await fetchHealth(state.port);
  if (!health || health.daemonVersion !== state.version) return null;
  return { state, health };
}

async function waitForDaemon(
  statePath: string,
  timeoutMs: number,
): Promise<{ state: GraftHostDaemonState; health: GraftDesktopHealth }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const daemon = await currentDaemon(statePath);
    if (daemon) return daemon;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("graft-host did not become ready within five seconds");
}

function synaraEntry(): string {
  if (process.env.GRAFT_HOST_SYNARA_BIN?.trim()) return process.env.GRAFT_HOST_SYNARA_BIN.trim();
  return fileURLToPath(new URL("../../server/src/index.ts", import.meta.url));
}

export function issueBootstrap(
  databasePath: string,
  health: GraftDesktopHealth,
): GraftDesktopBootstrapResponse {
  const store = new OccupancyStore(databasePath);
  try {
    const identity = store.getOrCreateIdentity(health.environmentLabel);
    if (identity.environmentId !== health.environmentId) {
      throw new Error("Daemon health identity does not match its durable store");
    }
    const enrollment = store.issueEnrollmentToken();
    return GraftDesktopBootstrapResponseSchema.parse({
      protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
      environmentId: identity.environmentId,
      environmentLabel: identity.environmentLabel,
      daemonVersion: health.daemonVersion,
      platform: health.platform,
      port: health.port,
      enrollmentToken: enrollment.token,
      enrollmentExpiresAt: enrollment.expiresAt,
      activeRunCount: health.activeRunCount,
      activePtyCount: health.activePtyCount,
    });
  } finally {
    store.close();
  }
}

async function ensureDaemon(
  arguments_: ParsedHostArguments,
): Promise<{ state: GraftHostDaemonState; health: GraftDesktopHealth }> {
  const paths = resolveGraftHostPaths(arguments_.dataRoot);
  const existing = await currentDaemon(paths.statePath);
  if (existing?.health.daemonVersion === GRAFT_HOST_VERSION) return existing;
  const executable = process.argv[1];
  if (!executable) throw new Error("Cannot locate the graft-host executable");
  const childArguments = [
    executable,
    "serve",
    "--data-dir",
    arguments_.dataRoot,
    "--environment-label",
    arguments_.environmentLabel,
    "--port",
    String(arguments_.port),
  ];
  if (arguments_.allowUnsupportedPlatform) {
    childArguments.push("--allow-unsupported-platform");
  }
  const child = spawn(process.execPath, childArguments, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return waitForDaemon(paths.statePath, 8_000);
}

async function serve(arguments_: ParsedHostArguments): Promise<void> {
  if (!arguments_.allowUnsupportedPlatform) {
    requireSupportedHostPlatform();
  }
  const paths = resolveGraftHostPaths(arguments_.dataRoot);
  mkdirSync(paths.dataRoot, { recursive: true, mode: 0o700 });
  mkdirSync(paths.synaraHome, { recursive: true, mode: 0o700 });
  const port = arguments_.port === 0 ? await reserveLoopbackPort() : arguments_.port;
  writeDaemonState(paths.statePath, {
    pid: process.pid,
    port,
    version: GRAFT_HOST_VERSION,
    startedAt: Date.now(),
  });
  const shutdown = () => {
    removeDaemonState(paths.statePath, process.pid);
  };
  process.on("exit", shutdown);
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });

  const child = spawn(
    process.execPath,
    [
      synaraEntry(),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--home-dir",
      paths.synaraHome,
      "--no-browser",
    ],
    {
      env: {
        ...process.env,
        GRAFT_HOST: "1",
        GRAFT_HOST_DATA_DIR: paths.dataRoot,
        GRAFT_HOST_ENVIRONMENT_LABEL: arguments_.environmentLabel,
        SYNARA_HOME: paths.synaraHome,
        SYNARA_HOST: "127.0.0.1",
        SYNARA_NO_BROWSER: "1",
      },
      stdio: "inherit",
    },
  );
  const exitCode = await new Promise<number>((resolveExit) => {
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
  shutdown();
  process.exit(exitCode);
}

async function diagnostics(arguments_: ParsedHostArguments): Promise<void> {
  const paths = resolveGraftHostPaths(arguments_.dataRoot);
  const platform = diagnoseHostPlatform();
  const daemon = await currentDaemon(paths.statePath);
  const payload = {
    version: GRAFT_HOST_VERSION,
    platform,
    dataRoot: paths.dataRoot,
    occupancyDatabase: paths.databasePath,
    occupancyDatabaseExists: existsSync(paths.databasePath),
    daemon: daemon
      ? {
          pid: daemon.state.pid,
          port: daemon.state.port,
          version: daemon.state.version,
          environmentId: daemon.health.environmentId,
        }
      : null,
  };
  if (arguments_.json) {
    writeJson(payload);
    return;
  }
  process.stdout.write(
    [
      `graft-host ${GRAFT_HOST_VERSION}`,
      platform.message,
      `data: ${paths.dataRoot}`,
      daemon
        ? `daemon: pid ${daemon.state.pid} on 127.0.0.1:${daemon.state.port}`
        : "daemon: not running",
      "",
    ].join("\n"),
  );
}

async function selfTest(arguments_: ParsedHostArguments): Promise<void> {
  const daemon = await ensureDaemon(arguments_);
  const bootstrap = issueBootstrap(
    resolveGraftHostPaths(arguments_.dataRoot).databasePath,
    daemon.health,
  );
  writeJson({
    ok: true,
    health: daemon.health,
    bootstrap: {
      environmentId: bootstrap.environmentId,
      port: bootstrap.port,
      enrollmentExpiresAt: bootstrap.enrollmentExpiresAt,
    },
  });
}

export async function runGraftHost(values = process.argv.slice(2)): Promise<void> {
  const parsed = parseHostArguments(values);
  switch (parsed.command) {
    case "help":
      process.stdout.write(`${usage()}\n`);
      return;
    case "version":
      process.stdout.write(`${GRAFT_HOST_VERSION}\n`);
      return;
    case "diagnostics":
      await diagnostics(parsed);
      return;
    case "serve":
      await serve(parsed);
      return;
    case "bootstrap": {
      const daemon = await ensureDaemon(parsed);
      writeJson(
        issueBootstrap(resolveGraftHostPaths(parsed.dataRoot).databasePath, daemon.health),
      );
      return;
    }
    case "self-test":
      await selfTest(parsed);
      return;
  }
}

if (import.meta.main) {
  void runGraftHost().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
