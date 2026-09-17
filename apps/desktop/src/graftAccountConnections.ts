import { waitForHttpReady } from "./backendReadiness";

/** Remote listeners finish restoring before httpListening, ahead of history import readiness. */
export async function disconnectGraftAccountConnections(input: {
  readonly baseUrl: string;
  readonly ownerToken: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  await waitForHttpReady(input.baseUrl, {
    path: "/health",
    timeoutMs: 15_000,
    fetchImpl,
    isReady: async (response) => {
      if (!response.ok) return false;
      const state: unknown = await response.json();
      return Boolean(
        state &&
        typeof state === "object" &&
        "httpListening" in state &&
        state.httpListening === true,
      );
    },
  });
  const url = new URL("/api/graft/connections/account/disconnect", input.baseUrl);
  url.searchParams.set("token", input.ownerToken);
  const response = await fetchImpl(url, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Could not disconnect this device.");
}
