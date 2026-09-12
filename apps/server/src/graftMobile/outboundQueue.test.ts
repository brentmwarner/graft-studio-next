import { Effect, Queue, Semaphore } from "effect";
import { describe, expect, it } from "vitest";
import type { GraftMobileHostMessage } from "@graft/mobile-contract";

import {
  MOBILE_WS_OUTBOUND_CAPACITY,
  mobileBackpressureSnapshot,
  offerMobileOutbound,
  replaceOverflowingOutbound,
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

const welcome: GraftMobileHostMessage = {
  envelope: "welcome",
  protocolVersion: 1,
  capabilities: ["projects"],
  environmentId: "env-1",
  environmentLabel: "Mac",
  cursor: 0,
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
        const lock = yield* Semaphore.make(1);
        yield* offerMobileOutbound(outbound, liveEvent, lock);
        yield* offerMobileOutbound(outbound, liveEvent, lock);
        yield* offerMobileOutbound(outbound, liveEvent, lock);
        return [...(yield* Queue.takeAll(outbound))].map((frame) => JSON.parse(frame) as object);
      }).pipe(Effect.scoped),
    );
    expect(frames).toEqual([mobileBackpressureSnapshot()]);
  });

  it("keeps a completing command when the queue overflows", async () => {
    const frames = await Effect.runPromise(
      Effect.gen(function* () {
        const outbound = yield* Queue.dropping<string>(2);
        const lock = yield* Semaphore.make(1);
        yield* offerMobileOutbound(outbound, liveEvent, lock);
        yield* offerMobileOutbound(outbound, liveEvent, lock);
        yield* offerMobileOutbound(outbound, commandResponse, lock);
        return [...(yield* Queue.takeAll(outbound))].map((frame) => JSON.parse(frame) as object);
      }).pipe(Effect.scoped),
    );
    expect(frames).toEqual([mobileBackpressureSnapshot(), commandResponse]);
  });

  it("keeps welcome ahead of snapshot_required after overflow", () => {
    const frames = replaceOverflowingOutbound(
      [JSON.stringify(liveEvent), JSON.stringify(welcome), JSON.stringify(liveEvent)],
      commandResponse,
    ).map((frame) => JSON.parse(frame) as GraftMobileHostMessage);
    expect(frames[0]?.envelope).toBe("welcome");
    expect(frames[1]).toEqual(mobileBackpressureSnapshot());
    expect(frames.some((frame) => frame.envelope === "response")).toBe(true);
  });

  it("keeps both command responses when concurrent overflow is serialized", async () => {
    const frames = await Effect.runPromise(
      Effect.gen(function* () {
        const outbound = yield* Queue.dropping<string>(4);
        const lock = yield* Semaphore.make(1);
        yield* offerMobileOutbound(outbound, liveEvent, lock);
        yield* offerMobileOutbound(outbound, liveEvent, lock);
        yield* offerMobileOutbound(outbound, liveEvent, lock);
        yield* offerMobileOutbound(outbound, liveEvent, lock);
        const second: GraftMobileHostMessage = {
          ...commandResponse,
          commandId: "command-2",
          receipt: { commandId: "command-2", status: "completed" },
        };
        yield* Effect.all(
          [
            offerMobileOutbound(outbound, commandResponse, lock),
            offerMobileOutbound(outbound, second, lock),
          ],
          { concurrency: 2 },
        );
        return [...(yield* Queue.takeAll(outbound))].map(
          (frame) => JSON.parse(frame) as GraftMobileHostMessage,
        );
      }).pipe(Effect.scoped),
    );
    const commandIds = frames
      .filter((frame) => frame.envelope === "response")
      .map((frame) => (frame.envelope === "response" ? frame.commandId : ""));
    expect(commandIds.sort()).toEqual(["command-1", "command-2"]);
  });
});
