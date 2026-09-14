import type { GraftDesktopRelayStatus } from "@graft/mobile-contract/relay";

import { relayNetworkEndpoint } from "./networkEndpoints";

const DISABLED: GraftDesktopRelayStatus = {
  state: "disabled",
  httpBaseUrl: null,
  wsBaseUrl: null,
  lastError: null,
};
let status = DISABLED;
let lastUpdatedAt = 0;

export function setDesktopRelayStatus(next: GraftDesktopRelayStatus): void {
  status = next;
  lastUpdatedAt = Date.now();
}

export function getDesktopRelayStatus(): GraftDesktopRelayStatus {
  // The desktop renews this lease. Never issue a QR for an abandoned uplink.
  return Date.now() - lastUpdatedAt < 30_000 ? status : DISABLED;
}

export function getDesktopRelayEndpoint() {
  const current = getDesktopRelayStatus();
  return current.state === "connected" && current.httpBaseUrl && current.wsBaseUrl
    ? relayNetworkEndpoint({ httpBaseUrl: current.httpBaseUrl, wsBaseUrl: current.wsBaseUrl })
    : null;
}
