import {
  GRAFT_DESKTOP_CAPABILITIES,
  GRAFT_DESKTOP_ENDPOINTS,
  GRAFT_DESKTOP_PROTOCOL_VERSION,
  GraftDesktopEnrollmentResponseSchema,
  GraftDesktopHealthSchema,
  type GraftDesktopEnrollmentResponse,
} from "@graft/desktop-contract";

import { ManagedSshTunnel } from "./managedSshTunnel";
import { SshHostInstaller } from "./sshHostInstaller";
import { SshMachineStore } from "./sshMachineStore";
import { SshSecretStore } from "./sshSecretStore";
import { resolveSshTarget, type SshCommandRunner } from "./sshTarget";
import {
  SshRemoteError,
  type SavedSshMachine,
  type SshMachineSummary,
  type SshRemoteConnection,
  toSshMachineSummary,
} from "./sshRemoteTypes";

export interface SshRemoteConnectionManagerOptions {
  machineStore: SshMachineStore;
  secretStore: SshSecretStore;
  hostArchivePath: string;
  hostVersion: string;
  clientId: string;
  clientLabel: string;
  clientVersion: string;
  sshExecutable?: string;
  scpExecutable?: string;
  commandRunner?: SshCommandRunner;
  createTunnel?: (options: ConstructorParameters<typeof ManagedSshTunnel>[0]) => ManagedSshTunnel;
}

export class SshRemoteConnectionManager {
  private readonly installer: SshHostInstaller;
  private readonly activeConnections = new Map<string, SshRemoteConnection>();
  private readonly connecting = new Map<string, Promise<SshRemoteConnection>>();
  private readonly closing = new Map<string, Promise<void>>();
  private readonly attempts = new Map<string, AbortController>();
  private disposed = false;

  constructor(private readonly options: SshRemoteConnectionManagerOptions) {
    this.installer = new SshHostInstaller({
      hostArchivePath: options.hostArchivePath,
      hostVersion: options.hostVersion,
      ...(options.sshExecutable === undefined ? {} : { sshExecutable: options.sshExecutable }),
      ...(options.scpExecutable === undefined ? {} : { scpExecutable: options.scpExecutable }),
      ...(options.commandRunner === undefined ? {} : { runner: options.commandRunner }),
    });
  }

  listMachines(): SavedSshMachine[] {
    return this.options.machineStore.list();
  }

  listMachineSummaries(): SshMachineSummary[] {
    return this.listMachines().map((machine) =>
      toSshMachineSummary(machine, this.activeConnections.has(machine.id)),
    );
  }

  machineSummary(machine: SavedSshMachine): SshMachineSummary {
    return toSshMachineSummary(machine, this.activeConnections.has(machine.id));
  }

  activeConnection(machineId: string): SshRemoteConnection | null {
    return this.activeConnections.get(machineId) ?? null;
  }

  saveMachine(input: { id?: string; label: string; sshTarget: string }): SavedSshMachine {
    return this.options.machineStore.save(input);
  }

  async deleteMachine(id: string): Promise<boolean> {
    const activeConnection = this.activeConnections.get(id);
    if (activeConnection) {
      try {
        await this.revokeSession(activeConnection.routes.httpBaseUrl, activeConnection.bearer);
      } catch {
        // Remote revoke is best-effort so an unreachable host can still be removed.
      }
    }
    await this.disconnect(id);
    const deleted = this.options.machineStore.delete(id);
    if (!deleted) return false;
    if (deleted.secretAccountKey) {
      this.options.secretStore.delete(deleted.secretAccountKey);
    }
    return true;
  }

  async connect(machineId: string): Promise<SshRemoteConnection> {
    if (this.disposed)
      throw new SshRemoteError("connection_closed", "SSH connections are closed.", false);
    const inFlight = this.connecting.get(machineId);
    if (inFlight) return inFlight;
    const existing = this.activeConnections.get(machineId);
    if (existing && !this.closing.has(machineId)) return existing;

    const controller = new AbortController();
    this.attempts.set(machineId, controller);
    const pending = this.establishConnection(machineId, controller.signal).finally(() => {
      if (this.connecting.get(machineId) === pending) {
        this.connecting.delete(machineId);
        this.attempts.delete(machineId);
      }
    });
    this.connecting.set(machineId, pending);
    return pending;
  }

  private async establishConnection(
    machineId: string,
    signal: AbortSignal,
  ): Promise<SshRemoteConnection> {
    const checkCancelled = () => {
      if (signal.aborted)
        throw new SshRemoteError("connection_closed", "SSH connection was cancelled.", false);
    };
    await this.closing.get(machineId);
    checkCancelled();
    const originalMachine = this.options.machineStore.get(machineId);
    if (!originalMachine) throw new Error("SSH machine does not exist");
    const resolvedTarget = await resolveSshTarget(originalMachine.sshTarget, {
      signal,
      ...(this.options.sshExecutable === undefined
        ? {}
        : { sshExecutable: this.options.sshExecutable }),
      ...(this.options.commandRunner === undefined ? {} : { runner: this.options.commandRunner }),
    });
    checkCancelled();
    const bootstrap = await this.installer.bootstrap(resolvedTarget.target, signal);
    checkCancelled();
    const createTunnel = this.options.createTunnel ?? ((options) => new ManagedSshTunnel(options));
    const tunnel = createTunnel({
      target: resolvedTarget.target,
      remotePort: bootstrap.port,
      expectedEnvironmentId: bootstrap.environmentId,
      ...(this.options.sshExecutable === undefined
        ? {}
        : { sshExecutable: this.options.sshExecutable }),
    });
    const cancelTunnel = () => {
      void tunnel.close().catch(() => undefined);
    };
    signal.addEventListener("abort", cancelTunnel, { once: true });
    try {
      checkCancelled();
      const localPort = await tunnel.start();
      checkCancelled();
      const httpBaseUrl = `http://127.0.0.1:${localPort}`;
      const health = GraftDesktopHealthSchema.parse(
        await (
          await fetch(`${httpBaseUrl}${GRAFT_DESKTOP_ENDPOINTS.health}`, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
          })
        ).json(),
      );
      if (health.environmentId !== bootstrap.environmentId) {
        throw new SshRemoteError(
          "tunnel_failed",
          "The SSH tunnel reached a different Graft environment",
          false,
        );
      }
      const priorBearer = originalMachine.secretAccountKey
        ? this.options.secretStore.get(originalMachine.secretAccountKey)
        : null;
      checkCancelled();
      const enrollment = await this.enroll(httpBaseUrl, bootstrap.enrollmentToken, signal);
      if (signal.aborted) {
        await this.revokeSession(httpBaseUrl, enrollment.bearer);
        checkCancelled();
      }
      const secretAccountKey = `desktop-host:${machineId}:${enrollment.session.sessionId}`;
      try {
        this.options.secretStore.set(secretAccountKey, enrollment.bearer);
      } catch {
        await this.revokeSession(httpBaseUrl, enrollment.bearer);
        throw new SshRemoteError(
          "secret_store_unavailable",
          "Secure storage is unavailable for this remote connection",
          false,
        );
      }
      try {
        if (priorBearer) {
          await this.revokeSession(httpBaseUrl, priorBearer);
        }
      } catch (error) {
        this.options.secretStore.delete(secretAccountKey);
        await this.revokeSession(httpBaseUrl, enrollment.bearer);
        throw error;
      }
      let machine: SavedSshMachine;
      try {
        checkCancelled();
        machine = this.options.machineStore.recordConnection({
          machineId,
          resolvedTarget,
          bootstrap,
          enrollment,
          secretAccountKey,
        });
      } catch (error) {
        this.options.secretStore.delete(secretAccountKey);
        await this.revokeSession(httpBaseUrl, enrollment.bearer);
        throw error;
      }
      if (
        originalMachine.secretAccountKey &&
        originalMachine.secretAccountKey !== secretAccountKey
      ) {
        this.options.secretStore.delete(originalMachine.secretAccountKey);
      }
      const routes = {
        httpBaseUrl,
        wsUrl: `ws://127.0.0.1:${localPort}${GRAFT_DESKTOP_ENDPOINTS.socket}`,
      };
      let closePromise: Promise<void> | null = null;
      let connection!: SshRemoteConnection;
      const unsubscribeTunnel = tunnel.onState((state) => {
        if (state === "failed" || state === "closed") {
          void connection.close().catch(() => undefined);
        }
      });
      connection = {
        machine,
        resolvedTarget,
        bootstrap,
        environment: {
          environmentId: health.environmentId,
          environmentLabel: health.environmentLabel,
          daemonVersion: health.daemonVersion,
          protocolVersion: health.protocolVersion,
          capabilities: health.capabilities,
          cursor: health.cursor,
          replayFloor: health.replayFloor,
        },
        session: enrollment.session,
        bearer: enrollment.bearer,
        localPort,
        routes,
        close: async () => {
          unsubscribeTunnel();
          if (closePromise) return closePromise;
          const closing = tunnel
            .close()
            .then(() => {
              if (this.activeConnections.get(machineId) === connection) {
                this.activeConnections.delete(machineId);
              }
              if (this.closing.get(machineId) === closing) {
                this.closing.delete(machineId);
              }
            })
            .catch((error: unknown) => {
              closePromise = null;
              throw error;
            });
          closePromise = closing;
          this.closing.set(machineId, closing);
          await closing;
        },
      };
      this.activeConnections.set(machineId, connection);
      return connection;
    } catch (error) {
      await tunnel.close();
      checkCancelled();
      throw error;
    } finally {
      signal.removeEventListener("abort", cancelTunnel);
    }
  }

  async disconnect(machineId: string): Promise<void> {
    this.attempts.get(machineId)?.abort();
    await this.connecting.get(machineId)?.catch(() => undefined);
    await this.activeConnections.get(machineId)?.close();
  }

  async closeAll(): Promise<void> {
    this.disposed = true;
    for (const controller of this.attempts.values()) controller.abort();
    await Promise.allSettled(this.connecting.values());
    await Promise.allSettled(
      [...this.activeConnections.values()].map((connection) => connection.close()),
    );
    this.activeConnections.clear();
  }

  private async enroll(
    httpBaseUrl: string,
    enrollmentToken: string,
    signal: AbortSignal,
  ): Promise<GraftDesktopEnrollmentResponse> {
    let response: Response;
    try {
      response = await fetch(`${httpBaseUrl}${GRAFT_DESKTOP_ENDPOINTS.enroll}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
          enrollmentToken,
          clientId: this.options.clientId,
          clientLabel: this.options.clientLabel,
          clientVersion: this.options.clientVersion,
          capabilities: GRAFT_DESKTOP_CAPABILITIES,
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      });
    } catch {
      throw new SshRemoteError(
        "enrollment_failed",
        "The desktop session could not be enrolled through SSH",
        true,
      );
    }
    if (!response.ok) {
      throw new SshRemoteError(
        "enrollment_failed",
        "The desktop session enrollment was rejected",
        response.status >= 500,
      );
    }
    try {
      return GraftDesktopEnrollmentResponseSchema.parse(await response.json());
    } catch {
      throw new SshRemoteError(
        "incompatible_host",
        "The machine returned an incompatible enrollment response",
        false,
      );
    }
  }

  private async revokeSession(httpBaseUrl: string, bearer: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${httpBaseUrl}${GRAFT_DESKTOP_ENDPOINTS.session}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${bearer}` },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new SshRemoteError(
        "connection_closed",
        "The prior desktop session could not be revoked",
        true,
      );
    }
    if (response.ok || response.status === 401) return;
    throw new SshRemoteError(
      "connection_closed",
      "The prior desktop session could not be revoked",
      response.status >= 500,
    );
  }
}
