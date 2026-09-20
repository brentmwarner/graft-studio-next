import type { GraftTimelineEvent } from "@graft/mobile-contract";
import { describe, expect, it } from "vitest";

import { buildTranscriptItems, reconcileTranscriptItems } from "./mobileViewModels";

function frame(
  id: string,
  cursor: number,
  kind: GraftTimelineEvent["kind"],
  text: string,
): GraftTimelineEvent {
  return { id, cursor, kind, text, threadId: "thread", runId: "run", createdAt: cursor };
}

describe("transcript streaming identity", () => {
  it("keeps a reply in its original row through completion and snapshot replacement", () => {
    const delta = frame("reply", 1, "assistant.delta", "Hello");
    const complete = frame("reply", 2, "assistant.message", "Hello there");
    const live = buildTranscriptItems([], [delta]);
    const finished = buildTranscriptItems([], [delta, complete]);
    const saved = buildTranscriptItems([complete], [delta, complete], 2);
    expect(live.map((row) => row.id)).toEqual(finished.map((row) => row.id));
    expect(finished).toEqual(saved);
    expect(reconcileTranscriptItems(finished, saved)).toBe(finished);
  });

  it("normalizes legacy part delta/completion IDs to their saved part ID", () => {
    const first = frame("part:delta:5", 1, "assistant.delta", "Hello");
    const last = frame("part:complete", 2, "assistant.message", "Hello there");
    const saved = frame("part", 2, "assistant.message", "Hello there");
    expect(buildTranscriptItems([], [first, last])).toEqual(buildTranscriptItems([saved], [], 2));
  });

  it("does not overwrite commentary when a separate answer starts in the same run", () => {
    const events = [
      frame("commentary", 1, "assistant.delta", "Checking now."),
      frame("answer", 2, "assistant.delta", "The result is"),
      frame("commentary", 3, "assistant.message", "Checking now."),
      frame("answer", 4, "assistant.message", "The result is 42."),
    ];
    expect(
      buildTranscriptItems([], events).map((row) => row.kind === "assistant" && row.text),
    ).toEqual(["Checking now.", "The result is 42."]);
  });

  it("preserves identical answers from separate messages", () => {
    const events = [
      frame("a", 1, "assistant.message", "Done"),
      frame("b", 2, "assistant.message", "Done"),
    ];
    expect(buildTranscriptItems(events, [])).toHaveLength(2);
  });

  it("updates a saved message in place when tools follow it", () => {
    const saved = [
      frame("reply", 1, "assistant.delta", "Hello"),
      frame("tool", 2, "tool.start", "Read"),
    ];
    const tail = [frame("reply", 3, "assistant.message", "Hello there")];
    const before = buildTranscriptItems(saved, [], 2);
    const after = buildTranscriptItems(saved, tail, 2);
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    expect(after[0]).toMatchObject({ text: "Hello there", streaming: false });
  });

  it("keeps leading whitespace in code when a message completes", () => {
    const text = "    const answer = 42;\n";
    expect(buildTranscriptItems([], [frame("a", 1, "assistant.message", text)])[0]).toMatchObject({
      text,
    });
  });
  it("does not restart completed text on a delayed cumulative frame", () => {
    const items = buildTranscriptItems(
      [],
      [
        frame("a", 1, "assistant.message", "The complete answer"),
        frame("a", 2, "assistant.delta", "The complete"),
      ],
    );
    expect(items).toMatchObject([{ text: "The complete answer", streaming: false }]);
  });

  it("does not stop a new run when the previous run's terminal event arrives", () => {
    const reply = { ...frame("reply", 1, "assistant.delta", "New answer"), runId: "new-run" };
    const stopped = {
      ...frame("old-status", 2, "run.status", ""),
      runId: "old-run",
      runStatus: "completed" as const,
    };
    expect(buildTranscriptItems([], [reply, stopped])[0]).toMatchObject({ streaming: true });
  });

  it("keeps a snapshot's live reply streaming while reconciling a user echo", () => {
    const user = frame("user", 0, "user.message", "Hello");
    const reply = frame("reply", 2, "assistant.delta", "Hello back");
    const echo = {
      ...frame("optimistic", 0, "user.message", "Hello"),
      optimisticAfterMessageId: null,
    };
    const items = buildTranscriptItems([user, reply], [echo], 2);
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ streaming: true, text: "Hello back" });
  });
});
