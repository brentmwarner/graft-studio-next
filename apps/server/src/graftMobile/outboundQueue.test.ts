import { Effect, Queue } from "effect";
import { describe, expect, it } from "vitest";

import {
  MOBILE_WS_OUTBOUND_CAPACITY,
  mobileBackpressureSnapshot,
  offerMobileOutbound,
} from "./outboundQueue";

describe("mobile outbound queue", () => {
  it("keeps a bounded capacity", () => {
    expect(MOBILE_WS_OUTBOUND_CAPACITY).toBeGreaterThan(0);
    expect(mobileBackpressureSnapshot()).toMatchObject({
      envelope: "snapshot_required",
      reason: "backpressure",
    });
  });

  it("replaces queued frames with snapshot_required when the queue is full", async () => {
    const frames = await Effect.runPromise(
      Effect.gen(function* () {
        const outbound = yield* Queue.dropping<string>(2);
        yield* offerMobileOutbound(outbound, { envelope: "pong", at: 1 });
        yield* offerMobileOutbound(outbound, { envelope: "pong", at: 2 });
        yield* offerMobileOutbound(outbound, { envelope: "pong", at: 3 });
        return [...(yield* Queue.takeAll(outbound))].map((frame) => JSON.parse(frame) as object);
      }).pipe(Effect.scoped),
    );
    expect(frames).toEqual([mobileBackpressureSnapshot()]);
  });
});
