import { Effect, Queue } from "effect";
import { describe, expect, it } from "vitest";
import type { GraftMobileHostMessage } from "@graft/mobile-contract";

import {
  MOBILE_WS_OUTBOUND_CAPACITY,
  mobileBackpressureSnapshot,
  offerMobileOutbound,
} from "./outboundQueue";

const liveEvent: GraftMobileHostMessage = {
  envelope: "event",
  event: {
    id: "e1",
    cursor: 1,
    kind: "user.message",
    threadId: "t1",
    createdAt: 1,
    text: "hi",
  },
};

const commandResponse: GraftMobileHostMessage = {
  envelope: "response",
  commandId: "command-1",
  receipt: {
    commandId: "command-1",
    status: "completed",
  },
};

describe("mobile outbound queue", () => {
  it("keeps a bounded capacity", () => {
    expect(MOBILE_WS_OUTBOUND_CAPACITY).toBeGreaterThan(0);
    expect(mobileBackpressureSnapshot()).toMatchObject({
      envelope: "snapshot_required",
      reason: "backpressure",
    });
  });

  it("drops live events and asks for a snapshot when the queue is full", async () => {
    const frames = await Effect.runPromise(
      Effect.gen(function* () {
        const outbound = yield* Queue.dropping<string>(2);
        yield* offerMobileOutbound(outbound, liveEvent);
        yield* offerMobileOutbound(outbound, liveEvent);
        yield* offerMobileOutbound(outbound, liveEvent);
        return [...(yield* Queue.takeAll(outbound))].map((frame) => JSON.parse(frame) as object);
      }).pipe(Effect.scoped),
    );
    expect(frames).toEqual([mobileBackpressureSnapshot()]);
  });

  it("keeps a completing command when the queue overflows", async () => {
    const frames = await Effect.runPromise(
      Effect.gen(function* () {
        const outbound = yield* Queue.dropping<string>(2);
        yield* offerMobileOutbound(outbound, liveEvent);
        yield* offerMobileOutbound(outbound, liveEvent);
        yield* offerMobileOutbound(outbound, commandResponse);
        return [...(yield* Queue.takeAll(outbound))].map((frame) => JSON.parse(frame) as object);
      }).pipe(Effect.scoped),
    );
    expect(frames).toEqual([mobileBackpressureSnapshot(), commandResponse]);
  });
});
