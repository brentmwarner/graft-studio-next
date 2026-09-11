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

export function isReliableMobileOutbound(message: GraftMobileHostMessage): boolean {
  return (
    message.envelope === "response" ||
    message.envelope === "error" ||
    message.envelope === "welcome" ||
    message.envelope === "pong"
  );
}

function parseOutboundFrame(frame: string): GraftMobileHostMessage | null {
  try {
    return JSON.parse(frame) as GraftMobileHostMessage;
  } catch {
    return null;
  }
}

export function offerMobileOutbound(
  outbound: Queue.Queue<string>,
  message: GraftMobileHostMessage,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const encoded = JSON.stringify(message);
    if (yield* Queue.offer(outbound, encoded)) return;
    const queued = yield* Queue.takeAll(outbound);
    const preserved = [...queued].filter((frame) => {
      const parsed = parseOutboundFrame(frame);
      return parsed !== null && isReliableMobileOutbound(parsed);
    });
    const replacement = [JSON.stringify(mobileBackpressureSnapshot())];
    if (isReliableMobileOutbound(message)) replacement.push(encoded);
    replacement.push(...preserved);
    for (const frame of replacement) {
      if (!(yield* Queue.offer(outbound, frame))) break;
    }
  }).pipe(Effect.asVoid);
}
