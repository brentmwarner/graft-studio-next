import type { GatewayConnectionState } from "../api/gatewaySocket";

interface GatewayConnectionStateShape {
  readonly connectionState: GatewayConnectionState;
  readonly error?: string;
}

export function withGatewayConnection<TState extends GatewayConnectionStateShape>(
  current: TState,
  connectionState: GatewayConnectionState,
): TState {
  return {
    ...current,
    connectionState,
    // A successful welcome frame proves the transport recovered. Do not keep
    // presenting the failure from an earlier host or reconnect attempt over a
    // live session.
    ...(connectionState === "connected" ? { error: undefined } : {}),
  };
}
