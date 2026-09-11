import type {
  GraftDesktopBootstrapResponse,
  GraftDesktopCapability,
  GraftDesktopEnvironment,
  GraftDesktopSessionRecord,
} from "@graft/desktop-contract";

export interface SavedSshMachine {
  id: string;
  label: string;
  sshTarget: string;
  effectiveHostname: string | null;
  effectiveUser: string | null;
  effectivePort: number | null;
  environmentId: string | null;
  environmentLabel: string | null;
  daemonVersion: string | null;
  protocolVersion: number | null;
  capabilities: GraftDesktopCapability[];
  sessionId: string | null;
  secretAccountKey: string | null;
  createdAt: number;
  updatedAt: number;
  lastConnectedAt: number | null;
}

export type SshMachineSummary = Omit<SavedSshMachine, "sessionId" | "secretAccountKey"> & {
  connected: boolean;
};

export function toSshMachineSummary(
  machine: SavedSshMachine,
  connected: boolean,
): SshMachineSummary {
  const { sessionId: _sessionId, secretAccountKey: _secretAccountKey, ...safe } = machine;
  return { ...safe, connected };
}

export interface ResolvedSshTarget {
  target: string;
  hostname: string;
  user: string;
  port: number;
  proxyJump: string | null;
}

export type SshRemoteErrorCode =
  | "invalid_target"
  | "ssh_unavailable"
  | "host_key_verification_failed"
  | "authentication_required"
  | "ssh_access_denied"
  | "network_unreachable"
  | "bootstrap_unavailable"
  | "incompatible_host"
  | "install_failed"
  | "tunnel_failed"
  | "enrollment_failed"
  | "secret_store_unavailable"
  | "connection_closed";

export class SshRemoteError extends Error {
  constructor(
    readonly code: SshRemoteErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SshRemoteError";
  }
}

export interface SshRemoteRoutes {
  httpBaseUrl: string;
  wsUrl: string;
}

export interface SshRemoteConnection {
  machine: SavedSshMachine;
  resolvedTarget: ResolvedSshTarget;
  bootstrap: GraftDesktopBootstrapResponse;
  environment: GraftDesktopEnvironment;
  session: GraftDesktopSessionRecord;
  bearer: string;
  localPort: number;
  routes: SshRemoteRoutes;
  close(): Promise<void>;
}
