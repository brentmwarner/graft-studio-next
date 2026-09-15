import { spawnProcess } from "@synara/shared/processRuntime";
import { signalOwnedChildProcess } from "../platform/processTreeController";
import { createServer } from "node:net";
import {
  GRAFT_DESKTOP_ENDPOINTS,
  GraftDesktopHealthSchema,
  type GraftDesktopHealth,
} from "@graft/desktop-contract";

import { classifySshFailure } from "./sshTarget";
import { SshRemoteError } from "./sshRemoteTypes";

export type SshTunnelState = "connecting" | "connected" | "reconnecting" | "closed" | "failed";

export interface TunnelProcess {
  stderr: NodeJS.ReadableStream | null;
  readonly pid?: number | undefined;
  exitCode: number | null;
  killed: boolean;
  on(event: "error", listener: (error: Error) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface ManagedSshTunnelOptions {
  target: string;
  remotePort: number;
  expectedEnvironmentId: string;
  sshExecutable?: string;
  localPort?: number;
  spawnProcess?: (executable: string, arguments_: readonly string[]) => TunnelProcess;
  healthProbe?: (localPort: number) => Promise<GraftDesktopHealth | null>;
  reservePort?: () => Promise<number>;
  reconnectDelaysMs?: readonly number[];
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

function spawnOpenSsh(executable: string, arguments_: readonly string[]): TunnelProcess {
  return spawnProcess(executable, arguments_, {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

async function probeHealth(localPort: number): Promise<GraftDesktopHealth | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${localPort}${GRAFT_DESKTOP_ENDPOINTS.health}`, {
      signal: AbortSignal.timeout(500),
    });
    if (!response.ok) return null;
    return GraftDesktopHealthSchema.parse(await response.json());
  } catch {
    return null;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export class ManagedSshTunnel {
  private readonly listeners = new Set<(state: SshTunnelState) => void>();
  private readonly spawnProcess: NonNullable<ManagedSshTunnelOptions["spawnProcess"]>;
  private readonly healthProbe: NonNullable<ManagedSshTunnelOptions["healthProbe"]>;
  private readonly reservePort: NonNullable<ManagedSshTunnelOptions["reservePort"]>;
  private readonly reconnectDelaysMs: readonly number[];
  private child: TunnelProcess | null = null;
  private closing = false;
  private closePromise: Promise<void> | null = null;
  private readonly exitedProcesses = new WeakSet<TunnelProcess>();
  private currentState: SshTunnelState = "closed";
  private stderr = "";
  private reconnectPromise: Promise<void> | null = null;
  private localPortValue: number | null;

  constructor(private readonly options: ManagedSshTunnelOptions) {
    this.spawnProcess = options.spawnProcess ?? spawnOpenSsh;
    this.healthProbe = options.healthProbe ?? probeHealth;
    this.reservePort = options.reservePort ?? reserveLoopbackPort;
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? [250, 500, 1_000, 2_000, 5_000];
    this.localPortValue = options.localPort ?? null;
  }

  get state(): SshTunnelState {
    return this.currentState;
  }

  get localPort(): number {
    if (this.localPortValue === null) throw new Error("SSH tunnel is not started");
    return this.localPortValue;
  }

  onState(listener: (state: SshTunnelState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<number> {
    if (this.currentState === "connected") return this.localPort;
    if (this.closing) {
      throw new SshRemoteError("connection_closed", "SSH connection is closed", false);
    }
    this.setState("connecting");
    this.localPortValue ??= await this.reservePort();
    await this.openProcess();
    return this.localPort;
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    const child = this.child;
    this.closePromise = (async () => {
      if (child) await this.stopProcess(child);
      if (this.child === child) this.child = null;
      await this.reconnectPromise?.catch(() => undefined);
      this.setState("closed");
    })().catch((error: unknown) => {
      this.closePromise = null;
      throw error;
    });
    return this.closePromise;
  }

  private async openProcess(): Promise<void> {
    if (this.child) {
      await this.stopProcess(this.child);
      this.child = null;
    }
    if (this.closing)
      throw new SshRemoteError("connection_closed", "SSH connection is closed.", false);
    this.stderr = "";
    const child = this.spawnProcess(this.options.sshExecutable ?? "ssh", [
      "-N",
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "RequestTTY=no",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-L",
      `127.0.0.1:${this.localPort}:127.0.0.1:${this.options.remotePort}`,
      "--",
      this.options.target,
    ]);
    this.child = child;
    child.stderr?.on("data", (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-16_384);
    });
    const exited = new Promise<never>((_resolveExit, rejectExit) => {
      child.on("error", (error) => {
        // A failed spawn has no process to reap. A running child's error (for
        // example, a failed kill) does not prove that it has exited.
        if (child.pid === undefined) this.exitedProcesses.add(child);
        rejectExit(error);
      });
      child.once("exit", () => {
        this.exitedProcesses.add(child);
        rejectExit(classifySshFailure(this.stderr));
        if (this.child === child) this.handleUnexpectedExit();
      });
    });
    const readiness = new AbortController();
    const ready = this.waitUntilReady(readiness.signal);
    try {
      await Promise.race([ready, exited]);
      if (this.child !== child) throw new Error("SSH tunnel process changed while opening");
      this.setState("connected");
    } catch (error) {
      readiness.abort();
      await this.stopProcess(child);
      if (this.child === child) this.child = null;
      if (error instanceof SshRemoteError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new SshRemoteError(
          "ssh_unavailable",
          "The system OpenSSH client is unavailable",
          false,
        );
      }
      throw new SshRemoteError("tunnel_failed", "The SSH tunnel could not be established", true);
    } finally {
      readiness.abort();
    }
  }

  private async stopProcess(child: TunnelProcess): Promise<void> {
    if (this.exitedProcesses.has(child) || child.exitCode !== null) return;
    await new Promise<void>((resolve, reject) => {
      const forceKill = setTimeout(() => signalOwnedChildProcess(child, "SIGKILL"), 1_000);
      const deadline = setTimeout(() => {
        clearTimeout(forceKill);
        reject(
          new SshRemoteError(
            "connection_closed",
            "The SSH process did not exit after disconnecting.",
            true,
          ),
        );
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(forceKill);
        clearTimeout(deadline);
        resolve();
      });
      child.once("error", () => {
        if (child.pid === undefined) {
          clearTimeout(forceKill);
          clearTimeout(deadline);
          resolve();
        }
      });
      signalOwnedChildProcess(child, "SIGTERM");
    });
  }

  private async waitUntilReady(signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (signal.aborted || this.closing)
        throw new SshRemoteError("connection_closed", "SSH connection is closed.", false);
      const health = await this.healthProbe(this.localPort);
      if (health?.environmentId === this.options.expectedEnvironmentId) return;
      await delay(100);
    }
    throw new SshRemoteError(
      "tunnel_failed",
      "The SSH tunnel opened but graft-host did not respond",
      true,
    );
  }

  private handleUnexpectedExit(): void {
    if (this.closing || this.reconnectPromise || this.currentState === "connecting") {
      return;
    }
    this.child = null;
    this.setState("reconnecting");
    this.reconnectPromise = this.reconnect().finally(() => {
      this.reconnectPromise = null;
    });
  }

  private async reconnect(): Promise<void> {
    for (const reconnectDelay of this.reconnectDelaysMs) {
      await delay(reconnectDelay);
      if (this.closing) return;
      try {
        await this.openProcess();
        return;
      } catch {
        // Continue through the bounded reconnect schedule.
      }
    }
    if (!this.closing) this.setState("failed");
  }

  private setState(state: SshTunnelState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    for (const listener of this.listeners) listener(state);
  }
}
