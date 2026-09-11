import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { WebSocket } from "ws";
import { DesktopHostStore } from "@graft/host-runtime";
import {
  GRAFT_DESKTOP_ENDPOINTS,
  GRAFT_DESKTOP_PROTOCOL_VERSION,
  GraftDesktopBootstrapResponseSchema,
  GraftDesktopEnrollmentResponseSchema,
  GraftDesktopHealthSchema,
  GraftDesktopHostMessageSchema,
  GraftDesktopJsonValueSchema,
  type GraftDesktopBootstrapResponse,
  type GraftDesktopHealth,
} from "@graft/shared";
import { GRAFT_HOST_VERSION } from "./constants.js";
import {
  readDaemonState,
  removeDaemonState,
  writeDaemonState,
  type GraftHostDaemonState,
} from "./daemonState.js";
import {
  defaultEnvironmentLabel,
  defaultGraftHostDataRoot,
  resolveGraftHostPaths,
} from "./hostPaths.js";
import {
  diagnoseHostPlatform,
  LINUX_X64_GLIBC_PLATFORM,
  requireSupportedHostPlatform,
} from "./hostPlatform.js";
import { HostProcessLock } from "./hostProcessLock.js";
import { GraftHostServer, type GraftHostActivity } from "./hostServer.js";
import {
  HEADLESS_HOST_CAPABILITIES,
  HeadlessHostRuntime,
} from "./headlessHostRuntime.js";
import { VersionedHostInstallation } from "./versionedInstallation.js";

type CommandName =
  | "serve"
  | "bootstrap"
  | "diagnostics"
  | "activate"
  | "rollback"
  | "self-test"
  | "version"
  | "help";

interface ParsedArguments {
  command: CommandName;
  dataRoot: string;
  environmentLabel: string;
  port: number;
  version?: string;
  source?: string;
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
    "  diagnostics  Report platform, storage, daemon, and installation status",
    "  activate     Atomically activate an installed version",
    "  rollback     Atomically return to the previous version",
    "  self-test    Exercise health and enrollment without a display server",
    "  version      Print the daemon version",
    "",
    "Options:",
    "  --data-dir <path>            Override the host data directory",
    "  --environment-label <label> Override the machine label",
    "  --port <port>                Loopback port; 0 selects an available port",
    "  --version <version>          Version to activate",
    "  --source <directory>         Stage this directory before activation",
    "  --json                       Emit structured diagnostics",
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

function parseArguments(values: string[]): ParsedArguments {
  const commandValue = values[0] ?? "help";
  const commands = new Set<CommandName>([
    "serve",
    "bootstrap",
    "diagnostics",
    "activate",
    "rollback",
    "self-test",
    "version",
    "help",
  ]);
  if (!commands.has(commandValue as CommandName)) {
    throw new Error(`Unknown graft-host command: ${commandValue}`);
  }
  const parsed: ParsedArguments = {
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
    } else if (value === "--version") {
      parsed.version = requireValue(values, index, value);
      index += 1;
    } else if (value === "--source") {
      parsed.source = resolve(requireValue(values, index, value));
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

async function fetchHealth(port: number): Promise<GraftDesktopHealth | null> {
  try {
    const response = await fetch(
      `http://127.0.0.1:${port}${GRAFT_DESKTOP_ENDPOINTS.health}`,
      { signal: AbortSignal.timeout(1_000) },
    );
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

async function stopMismatchedIdleDaemon(
  daemon: { state: GraftHostDaemonState; health: GraftDesktopHealth },
  statePath: string,
): Promise<boolean> {
  const { activeRunCount, activePtyCount } = daemon.health;
  if (activeRunCount > 0 || activePtyCount > 0) {
    return false;
  }

  process.kill(daemon.state.pid, "SIGTERM");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = readDaemonState(statePath);
    if (!state || state.pid !== daemon.state.pid) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("The prior graft-host daemon did not stop during upgrade");
}

async function ensureDaemon(
  arguments_: ParsedArguments,
): Promise<{ state: GraftHostDaemonState; health: GraftDesktopHealth }> {
  const paths = resolveGraftHostPaths(arguments_.dataRoot);
  const existing = await currentDaemon(paths.statePath);
  if (existing?.health.daemonVersion === GRAFT_HOST_VERSION) return existing;
  if (existing) {
    const stopped = await stopMismatchedIdleDaemon(existing, paths.statePath);
    if (!stopped) return existing;
  }
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
  return waitForDaemon(paths.statePath, 5_000);
}

function issueBootstrap(
  databasePath: string,
  health: GraftDesktopHealth,
): GraftDesktopBootstrapResponse {
  const store = new DesktopHostStore(databasePath);
  try {
    const identity = store.getOrCreateIdentity(health.environmentLabel);
    if (identity.environmentId !== health.environmentId) {
      throw new Error(
        "Daemon health identity does not match its durable store",
      );
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

async function serve(arguments_: ParsedArguments): Promise<void> {
  const paths = resolveGraftHostPaths(arguments_.dataRoot);
  mkdirSync(paths.dataRoot, { recursive: true, mode: 0o700 });
  const processLock = HostProcessLock.acquire(paths.lockPath);
  const platform = arguments_.allowUnsupportedPlatform
    ? LINUX_X64_GLIBC_PLATFORM
    : requireSupportedHostPlatform();
  let server: GraftHostServer | null = null;
  const runtime = new HeadlessHostRuntime(
    paths.databasePath,
    paths.dataRoot,
    (channel, payload) =>
      server?.publishEnvironmentEvent({
        channel,
        payload: GraftDesktopJsonValueSchema.parse(payload),
      }),
  );
  server = new GraftHostServer({
    databasePath: paths.databasePath,
    environmentLabel: arguments_.environmentLabel,
    port: arguments_.port,
    platform,
    capabilities: HEADLESS_HOST_CAPABILITIES,
    enrollmentGrants: HEADLESS_HOST_CAPABILITIES,
    getActivity: () => runtime.activity,
    authorizeCommand: (input) => runtime.authorize(input),
    dispatchCommand: async (session, command) => {
      const prepared = server?.prepareUploadedCommand(
        session.sessionId,
        command,
      );
      if (!prepared) throw new Error("The host server is unavailable");
      try {
        const result = await runtime.dispatch(prepared.command, {
          releaseTemporaryUploads: prepared.release,
        });
        if (!prepared.retainUntilRunCompletes) prepared.release();
        return result === undefined
          ? undefined
          : GraftDesktopJsonValueSchema.parse(result);
      } catch (error) {
        prepared.release();
        throw error;
      }
    },
  });
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      runtime.close();
      await server?.close();
    } finally {
      removeDaemonState(paths.statePath, process.pid);
      processLock.release();
    }
  };
  process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
  process.once("exit", () => {
    removeDaemonState(paths.statePath, process.pid);
    processLock.release();
  });
  try {
    const port = await server.start();
    const state: GraftHostDaemonState = {
      pid: process.pid,
      port,
      version: GRAFT_HOST_VERSION,
      startedAt: Date.now(),
    };
    writeDaemonState(paths.statePath, state);
    writeJson({ ready: true, ...state, address: "127.0.0.1" });
  } catch (error) {
    await shutdown();
    throw error;
  }
}

async function bootstrap(arguments_: ParsedArguments): Promise<void> {
  const paths = resolveGraftHostPaths(arguments_.dataRoot);
  const daemon = await ensureDaemon(arguments_);
  writeJson(issueBootstrap(paths.databasePath, daemon.health));
}

async function daemonActivity(statePath: string): Promise<GraftHostActivity> {
  const daemon = await currentDaemon(statePath);
  return daemon?.health ?? { activeRunCount: 0, activePtyCount: 0 };
}

async function diagnostics(arguments_: ParsedArguments): Promise<void> {
  const paths = resolveGraftHostPaths(arguments_.dataRoot);
  const platform = diagnoseHostPlatform();
  let storage: { writable: boolean; error?: string };
  try {
    mkdirSync(paths.dataRoot, { recursive: true, mode: 0o700 });
    const store = new DesktopHostStore(paths.databasePath);
    store.getOrCreateIdentity(arguments_.environmentLabel);
    store.close();
    storage = { writable: true };
  } catch (error) {
    storage = {
      writable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const daemon = await currentDaemon(paths.statePath);
  const installation = new VersionedHostInstallation(paths.installationRoot);
  const result = {
    ok: platform.compatible && storage.writable,
    version: GRAFT_HOST_VERSION,
    platform,
    storage,
    daemon: daemon ?? null,
    installation: { currentVersion: installation.currentVersion() },
  };
  if (arguments_.json) writeJson(result);
  else {
    process.stdout.write(
      `${result.ok ? "ok" : "not ready"}: ${platform.message}; storage ${storage.writable ? "writable" : "unavailable"}\n`,
    );
  }
  if (!result.ok) process.exitCode = 1;
}

async function activate(arguments_: ParsedArguments): Promise<void> {
  if (!arguments_.version) throw new Error("activate requires --version");
  const paths = resolveGraftHostPaths(arguments_.dataRoot);
  const installation = new VersionedHostInstallation(paths.installationRoot);
  if (arguments_.source)
    installation.stage(arguments_.version, arguments_.source);
  installation.activate(
    arguments_.version,
    await daemonActivity(paths.statePath),
  );
  writeJson({ activated: arguments_.version });
}

async function rollback(arguments_: ParsedArguments): Promise<void> {
  const paths = resolveGraftHostPaths(arguments_.dataRoot);
  const installation = new VersionedHostInstallation(paths.installationRoot);
  const version = installation.rollback(await daemonActivity(paths.statePath));
  writeJson({ activated: version, rolledBack: true });
}

async function receiveWelcome(url: string, bearer: string): Promise<unknown> {
  return new Promise((resolveWelcome, rejectWelcome) => {
    const socket = new WebSocket(url, {
      headers: { authorization: `Bearer ${bearer}` },
    });
    const timeout = setTimeout(() => {
      socket.terminate();
      rejectWelcome(new Error("Timed out waiting for graft-host welcome"));
    }, 2_000);
    socket.once("open", () => {
      socket.send(
        JSON.stringify({
          envelope: "hello",
          protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
          clientVersion: GRAFT_HOST_VERSION,
          capabilities: ["diagnostics"],
          afterCursor: 0,
        }),
      );
    });
    socket.once("message", (data) => {
      clearTimeout(timeout);
      socket.close();
      resolveWelcome(JSON.parse(data.toString()) as unknown);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      rejectWelcome(error);
    });
  });
}

async function selfTest(arguments_: ParsedArguments): Promise<void> {
  const paths = resolveGraftHostPaths(arguments_.dataRoot);
  const server = new GraftHostServer({
    databasePath: paths.databasePath,
    environmentLabel: `${hostname()} self-test`,
    platform: LINUX_X64_GLIBC_PLATFORM,
    capabilities: ["diagnostics"],
    enrollmentGrants: ["diagnostics"],
  });
  try {
    const port = await server.start();
    const health = GraftDesktopHealthSchema.parse(
      await (
        await fetch(`http://127.0.0.1:${port}${GRAFT_DESKTOP_ENDPOINTS.health}`)
      ).json(),
    );
    const bootstrapResponse = server.bootstrap();
    const enrollmentResponse = await fetch(
      `http://127.0.0.1:${port}${GRAFT_DESKTOP_ENDPOINTS.enroll}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
          enrollmentToken: bootstrapResponse.enrollmentToken,
          clientId: "graft-host-self-test",
          clientLabel: "graft-host self-test",
          clientVersion: GRAFT_HOST_VERSION,
          capabilities: ["diagnostics"],
        }),
      },
    );
    if (!enrollmentResponse.ok) {
      throw new Error(
        `Enrollment failed with HTTP ${enrollmentResponse.status}`,
      );
    }
    const enrollment = GraftDesktopEnrollmentResponseSchema.parse(
      await enrollmentResponse.json(),
    );
    const welcome = GraftDesktopHostMessageSchema.parse(
      await receiveWelcome(
        `ws://127.0.0.1:${port}${GRAFT_DESKTOP_ENDPOINTS.socket}`,
        enrollment.bearer,
      ),
    );
    if (welcome.envelope !== "welcome") {
      throw new Error("graft-host did not return a welcome message");
    }
    writeJson({
      ok: true,
      display: process.env.DISPLAY ?? null,
      waylandDisplay: process.env.WAYLAND_DISPLAY ?? null,
      environmentId: health.environmentId,
      port,
      enrollmentProfile: enrollment.session.profile,
      welcome: welcome.envelope,
    });
  } finally {
    await server.close();
  }
}

function assertNeverCommand(command: never): never {
  throw new Error(`Unhandled graft-host command: ${command}`);
}

async function run(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  switch (arguments_.command) {
    case "serve":
      await serve(arguments_);
      return;
    case "bootstrap":
      await bootstrap(arguments_);
      return;
    case "diagnostics":
      await diagnostics(arguments_);
      return;
    case "activate":
      await activate(arguments_);
      return;
    case "rollback":
      await rollback(arguments_);
      return;
    case "self-test":
      await selfTest(arguments_);
      return;
    case "version":
      process.stdout.write(`${GRAFT_HOST_VERSION}\n`);
      return;
    case "help":
      process.stdout.write(`${usage()}\n`);
      return;
    default:
      assertNeverCommand(arguments_.command);
  }
}

void run().catch((error) => {
  process.stderr.write(
    `graft-host: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
