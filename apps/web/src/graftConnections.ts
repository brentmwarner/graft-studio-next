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

async function requestJson<T>(
  path: string,
  options: { readonly method?: "GET" | "POST" | "DELETE"; readonly body?: unknown } = {},
): Promise<T> {
  const hasBody = options.body !== undefined;
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    ...(hasBody
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.body),
        }
      : {}),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Request failed with status ${response.status}`;
    throw new Error(message);
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
