import {
  GRAFT_DESKTOP_CAPABILITIES,
  GRAFT_DESKTOP_ENDPOINTS,
  GRAFT_DESKTOP_PROTOCOL_VERSION,
  GraftDesktopEnrollmentResponseSchema,
  GraftDesktopHealthSchema,
  type GraftDesktopEnrollmentResponse,
} from "@graft/shared";
import type { RemoteSessionSecretStore } from "../remoteGateway/remoteSessionSecretStore.js";
import { ManagedSshTunnel } from "./managedSshTunnel.js";
import { SshHostInstaller } from "./sshHostInstaller.js";
import { SshMachineStore } from "./sshMachineStore.js";
import { resolveSshTarget, type SshCommandRunner } from "./sshTarget.js";
import {
  SshRemoteError,
  type SavedSshMachine,
  type SshRemoteConnection,
  type SshMachineSummary,
  toSshMachineSummary,
} from "./sshRemoteTypes.js";

export interface SshRemoteConnectionManagerOptions {
  machineStore: SshMachineStore;
  secretStore: RemoteSessionSecretStore;
  hostArchivePath: string;
  hostVersion: string;
  clientId: string;
  clientLabel: string;
  clientVersion: string;
  sshExecutable?: string;
  scpExecutable?: string;
  commandRunner?: SshCommandRunner;
  createTunnel?: (
    options: ConstructorParameters<typeof ManagedSshTunnel>[0],
  ) => ManagedSshTunnel;
}

export class SshRemoteConnectionManager {
  private readonly installer: SshHostInstaller;
  private readonly activeConnections = new Map<string, SshRemoteConnection>();
  private readonly connecting = new Map<string, Promise<SshRemoteConnection>>();
  private readonly closing = new Map<string, Promise<void>>();

  constructor(private readonly options: SshRemoteConnectionManagerOptions) {
    this.installer = new SshHostInstaller({
      hostArchivePath: options.hostArchivePath,
      hostVersion: options.hostVersion,
      sshExecutable: options.sshExecutable,
      scpExecutable: options.scpExecutable,
      runner: options.commandRunner,
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

  saveMachine(input: {
    id?: string;
    label: string;
    sshTarget: string;
  }): SavedSshMachine {
    return this.options.machineStore.save(input);
  }

  async deleteMachine(id: string): Promise<boolean> {
    const activeConnection = this.activeConnections.get(id);
    if (activeConnection) {
      await this.revokeSession(
        activeConnection.routes.httpBaseUrl,
        activeConnection.bearer,
      );
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
    const inFlight = this.connecting.get(machineId);
    if (inFlight) return inFlight;
    const existing = this.activeConnections.get(machineId);
    if (existing && !this.closing.has(machineId)) return existing;

    const pending = this.establishConnection(machineId).finally(() => {
      if (this.connecting.get(machineId) === pending) {
        this.connecting.delete(machineId);
      }
    });
    this.connecting.set(machineId, pending);
    return pending;
  }

  private async establishConnection(
    machineId: string,
  ): Promise<SshRemoteConnection> {
    await this.disconnect(machineId);
    const originalMachine = this.options.machineStore.get(machineId);
    if (!originalMachine) throw new Error("SSH machine does not exist");
    const resolvedTarget = await resolveSshTarget(originalMachine.sshTarget, {
      sshExecutable: this.options.sshExecutable,
      runner: this.options.commandRunner,
    });
    const bootstrap = await this.installer.bootstrap(resolvedTarget.target);
    const createTunnel =
      this.options.createTunnel ?? ((options) => new ManagedSshTunnel(options));
    const tunnel = createTunnel({
      target: resolvedTarget.target,
      remotePort: bootstrap.port,
      expectedEnvironmentId: bootstrap.environmentId,
      sshExecutable: this.options.sshExecutable,
    });
    try {
      const localPort = await tunnel.start();
      const httpBaseUrl = `http://127.0.0.1:${localPort}`;
      const health = GraftDesktopHealthSchema.parse(
        await (
          await fetch(`${httpBaseUrl}${GRAFT_DESKTOP_ENDPOINTS.health}`, {
            signal: AbortSignal.timeout(2_000),
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
      const enrollment = await this.enroll(
        httpBaseUrl,
        bootstrap.enrollmentToken,
      );
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
      let closed = false;
      const connection: SshRemoteConnection = {
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
          if (closed) return this.closing.get(machineId);
          closed = true;
          const closing = tunnel.close().finally(() => {
            if (this.activeConnections.get(machineId) === connection) {
              this.activeConnections.delete(machineId);
            }
            if (this.closing.get(machineId) === closing) {
              this.closing.delete(machineId);
            }
          });
          this.closing.set(machineId, closing);
          await closing;
        },
      };
      this.activeConnections.set(machineId, connection);
      return connection;
    } catch (error) {
      await tunnel.close();
      throw error;
    }
  }

  async disconnect(machineId: string): Promise<void> {
    await this.activeConnections.get(machineId)?.close();
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled(
      [...this.activeConnections.values()].map((connection) =>
        connection.close(),
      ),
    );
    this.activeConnections.clear();
  }

  private async enroll(
    httpBaseUrl: string,
    enrollmentToken: string,
  ): Promise<GraftDesktopEnrollmentResponse> {
    let response: Response;
    try {
      response = await fetch(
        `${httpBaseUrl}${GRAFT_DESKTOP_ENDPOINTS.enroll}`,
        {
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
          signal: AbortSignal.timeout(5_000),
        },
      );
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

  private async revokeSession(
    httpBaseUrl: string,
    bearer: string,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(
        `${httpBaseUrl}${GRAFT_DESKTOP_ENDPOINTS.session}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${bearer}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
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
