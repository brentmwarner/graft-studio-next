import { Effect, Queue, Semaphore } from "effect";
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

export function replaceOverflowingOutbound(
  queued: readonly string[],
  overflowing: GraftMobileHostMessage,
): string[] {
  const encoded = JSON.stringify(overflowing);
  const welcomeFrames: string[] = [];
  const otherReliable: string[] = [];
  if (overflowing.envelope === "welcome") welcomeFrames.push(encoded);
  for (const frame of queued) {
    const parsed = parseOutboundFrame(frame);
    if (parsed === null || !isReliableMobileOutbound(parsed)) continue;
    if (parsed.envelope === "welcome") welcomeFrames.push(frame);
    else otherReliable.push(frame);
  }
  const replacement: string[] = [...welcomeFrames, JSON.stringify(mobileBackpressureSnapshot())];
  if (isReliableMobileOutbound(overflowing) && overflowing.envelope !== "welcome") {
    replacement.push(encoded);
  }
  replacement.push(...otherReliable);
  return replacement;
}

export function offerMobileOutbound(
  outbound: Queue.Queue<string>,
  message: GraftMobileHostMessage,
  lock: Semaphore.Semaphore,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const encoded = JSON.stringify(message);
    if (yield* Queue.offer(outbound, encoded)) return;
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        if (yield* Queue.offer(outbound, encoded)) return;
        const queued = yield* Queue.takeAll(outbound);
        const replacement = replaceOverflowingOutbound([...queued], message);
        for (const frame of replacement) {
          if (!(yield* Queue.offer(outbound, frame))) break;
        }
      }).pipe(Effect.asVoid),
    );
  }).pipe(Effect.asVoid);
}
