import { resolveWsHttpUrl } from "./lib/wsHttpUrl";

export interface GraftSshMachineSummary {
  id: string;
  label: string;
  sshTarget: string;
  effectiveHostname: string | null;
  connected: boolean;
  environmentLabel: string | null;
  daemonVersion: string | null;
}

export interface GraftMobilePairingLink {
  pairingUrl: string;
  expiresAt: number;
}

export type GraftConnectionsStatus = {
  enabled: boolean;
  networkAccessEnabled: boolean;
  environmentId: string;
  environmentLabel: string;
  bindHost: string;
  port: number | null;
  endpoints: Array<{
    kind: "relay" | "loopback" | "lan" | "tailnet" | "https";
    address: string;
    interfaceName: string;
    httpBaseUrl: string;
    wsBaseUrl: string;
  }>;
  devices: Array<{
    deviceId: string;
    sessionId: string;
    label: string;
    platform: "ios" | "android" | "web" | "desktop";
    appVersion: string;
    environmentLabel: string;
    lastSeenAt: number;
    connected: boolean;
  }>;
  pairingUrl: string | null;
  pairingExpiresAt: number | null;
  relay: {
    state: "disabled" | "connecting" | "connected" | "error";
    lastError: string | null;
  };
  diagnostics: string;
};

function errorMessageFromPayload(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  if ("error" in payload && typeof payload.error === "string") return payload.error;
  if ("message" in payload && typeof payload.message === "string") return payload.message;
  return fallback;
}

async function requestJson<T>(
  path: string,
  options: { readonly method?: "GET" | "POST" | "DELETE"; readonly body?: unknown } = {},
): Promise<T> {
  const hasBody = options.body !== undefined;
  const response = await fetch(resolveWsHttpUrl(path), {
    method: options.method ?? "GET",
    credentials: "include",
    ...(hasBody
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.body),
        }
      : {}),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(
      errorMessageFromPayload(payload, `Request failed with status ${response.status}`),
    );
  }
  if (payload === null || typeof payload !== "object") {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return payload as T;
}

export function createMobilePairingLink(): Promise<GraftMobilePairingLink> {
  return requestJson<GraftMobilePairingLink>("/v1/pairing-link", { method: "POST" });
}

export function getConnectionsStatus(): Promise<GraftConnectionsStatus> {
  return requestJson<GraftConnectionsStatus>("/api/graft/connections/status");
}

export function setConnectionsEnabled(enabled: boolean): Promise<GraftConnectionsStatus> {
  return requestJson<GraftConnectionsStatus>("/api/graft/connections/enabled", {
    method: "POST",
    body: { enabled },
  });
}

export function revokeConnectionsDevice(deviceId: string): Promise<GraftConnectionsStatus> {
  return requestJson<GraftConnectionsStatus>("/api/graft/connections/revoke-device", {
    method: "POST",
    body: { deviceId },
  });
}

export function listSshMachines(): Promise<{ machines: GraftSshMachineSummary[] }> {
  return requestJson("/api/graft/ssh/machines");
}

export function saveSshMachine(input: {
  label: string;
  sshTarget: string;
}): Promise<{ machine: GraftSshMachineSummary }> {
  return requestJson("/api/graft/ssh/machines", { method: "POST", body: input });
}

export function deleteSshMachine(id: string): Promise<{ deleted: boolean }> {
  return requestJson(`/api/graft/ssh/machines/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function connectSshMachine(id: string): Promise<{ machine: GraftSshMachineSummary }> {
  return requestJson(`/api/graft/ssh/machines/${encodeURIComponent(id)}/connect`, {
    method: "POST",
  });
}

export function disconnectSshMachine(
  id: string,
): Promise<{ machine: GraftSshMachineSummary | null }> {
  return requestJson(`/api/graft/ssh/machines/${encodeURIComponent(id)}/disconnect`, {
    method: "POST",
  });
}
