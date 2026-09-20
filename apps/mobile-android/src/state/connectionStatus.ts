import { GatewayError } from "../api/gateway";
import { GatewaySocketError } from "../api/gatewaySocket";

/** Sleeping/offline hosts are represented by their dot, not a warning banner. */
export function isOfflineError(error: unknown): boolean {
  return (
    (error instanceof GatewayError &&
      (error.code === "network" || error.code === "host_offline")) ||
    (error instanceof GatewaySocketError &&
      ["not_connected", "socket_closed", "host_offline", "timeout"].includes(error.code))
  );
}
