import { Effect, Queue } from "effect";
import type { GraftMobileHostMessage } from "@graft/mobile-contract";

export const MOBILE_WS_OUTBOUND_CAPACITY = 128;
export const MOBILE_WS_INBOUND_CAPACITY = 64;

export function mobileBackpressureSnapshot(): GraftMobileHostMessage {
  return {
    envelope: "snapshot_required",
    reason: "backpressure",
    message: "The mobile connection lagged behind live events.",
  };
}

export function offerMobileOutbound(
  outbound: Queue.Queue<string>,
  message: GraftMobileHostMessage,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const encoded = JSON.stringify(message);
    if (yield* Queue.offer(outbound, encoded)) return;
    yield* Queue.takeAll(outbound);
    yield* Queue.offer(outbound, JSON.stringify(mobileBackpressureSnapshot()));
  }).pipe(Effect.asVoid);
}
