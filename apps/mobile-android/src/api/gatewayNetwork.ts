import {
  addNetworkStateListener,
  getNetworkStateAsync,
  NetworkStateType,
  type NetworkState,
} from "expo-network";

import type { GatewaySocket } from "./gatewaySocket";

/** Rebind a foreground gateway when Wi-Fi, cellular, or VPN becomes the active route. */
export function watchGatewayNetwork(socket: Pick<GatewaySocket, "networkChanged">): () => void {
  let previous: NetworkState | undefined;
  let disposed = false;
  let receivedEvent = false;
  const update = (next: NetworkState) => {
    if (disposed || next.type === NetworkStateType.UNKNOWN) return false;
    const old = previous;
    previous = next;
    // Internet validation is a recovery hint, not a prerequisite for LAN access.
    if (next.isConnected === false) {
      if (old?.isConnected !== false) socket.networkChanged(false);
    } else if (
      old &&
      (old.isConnected === false ||
        (old.type !== next.type && next.type !== undefined) ||
        (old.isInternetReachable === false && next.isInternetReachable === true))
    ) {
      socket.networkChanged(true);
    }
    return true;
  };
  const subscription = addNetworkStateListener((next) => {
    if (update(next)) receivedEvent = true;
  });
  void getNetworkStateAsync().then(
    (initial) => {
      if (!receivedEvent) update(initial);
    },
    () => {
      // The socket's own handshake/heartbeat deadlines remain the fallback.
    },
  );
  return () => {
    disposed = true;
    subscription.remove();
  };
}
