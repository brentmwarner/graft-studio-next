import type { GraftSessionCredential } from "@graft/mobile-contract";

interface DevelopmentSessionEndpointInput {
  readonly host?: string;
  readonly isDevelopment: boolean;
  readonly isDevice: boolean;
  readonly session: GraftSessionCredential;
}

export function developmentSessionEndpoint({
  host,
  isDevelopment,
  isDevice,
  session,
}: DevelopmentSessionEndpointInput): GraftSessionCredential {
  const value = host?.trim();
  if (!isDevelopment || isDevice || !value) return session;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return session;
    url.pathname = "";
    url.search = "";
    url.hash = "";
    const httpBaseUrl = url.origin;
    const wsUrl = new URL(httpBaseUrl);
    wsUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return { ...session, httpBaseUrl, wsBaseUrl: wsUrl.origin };
  } catch {
    return session;
  }
}
