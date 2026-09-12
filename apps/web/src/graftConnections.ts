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
