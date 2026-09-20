import type { GraftTimelineEvent } from "@graft/mobile-contract";
import { describe, expect, it } from "vitest";

import { buildTranscriptItems } from "./mobileViewModels";
import { reconcileLiveUserMessages, type LocalTimelineEvent } from "./optimisticMessages";

function user(id: string, text: string, cursor = 1): GraftTimelineEvent {
  return { id, text, cursor, kind: "user.message", threadId: "thread", createdAt: cursor };
}
function local(id: string, text: string, anchor: string | null | undefined): LocalTimelineEvent {
  return { ...user(id, text, 0), optimisticAfterMessageId: anchor };
}
const texts = (settled: readonly GraftTimelineEvent[], live: readonly LocalTimelineEvent[]) =>
  buildTranscriptItems(settled, live, 10)
    .filter((item) => item.kind === "user")
    .map((item) => item.text);

describe("optimistic user messages", () => {
  it("preserves a send before history loads until a new live echo proves its boundary", () => {
    const pending = { ...local("pending", "Continue", undefined), optimisticAfterCursor: 20 };
    // Snapshot event cursors are not journal cursors, including a large old one.
    const settled = [user("old", "Continue", 100)];
    expect(reconcileLiveUserMessages(settled, [pending])).toEqual([pending]);
    const replay = user("old", "Continue", 20);
    expect(reconcileLiveUserMessages(settled, [pending, replay])).toEqual([pending, replay]);
    const echo = user("new", "Continue", 21);
    expect(reconcileLiveUserMessages(settled, [pending, echo])).toEqual([echo]);
    expect(reconcileLiveUserMessages([...settled, echo], [pending, echo])).toEqual([echo]);
  });

  it("remaps the next send after a send made before history loads is acknowledged", () => {
    const first = { ...local("first", "Continue", undefined), optimisticAfterCursor: 20 };
    const next = local("next", "Continue", "first");
    const echo = user("new", "Continue", 21);
    expect(reconcileLiveUserMessages([user("old", "Continue")], [first, next, echo])).toEqual([
      { ...next, optimisticAfterMessageId: "new" },
      echo,
    ]);
  });

  it("accepts exact message identity even when its history boundary is unavailable", () => {
    const pending = local("same", "Continue", "missing");
    expect(reconcileLiveUserMessages([user("same", "Continue")], [pending])).toEqual([]);
  });

  it("does not append older echoes after several snapshots and a new send", () => {
    const settled = [user("u1", "First"), user("u2", "Second")];
    const live = [
      local("l1", "First", null),
      local("l2", "Second", "l1"),
      local("l3", "Third", "l2"),
    ];
    expect(texts(settled, live)).toEqual(["First", "Second", "Third"]);
  });

  it("pairs repeated prompts one-to-one and preserves the next identical send", () => {
    const settled = [user("u1", "Continue"), user("u2", "Continue")];
    const live = [
      local("l1", "Continue", null),
      local("l2", "Continue", "l1"),
      local("l3", "Continue", "l2"),
    ];
    expect(texts(settled, live)).toEqual(["Continue", "Continue", "Continue"]);
  });

  it("does not swallow a new prompt that matches an older desktop message", () => {
    expect(texts([user("old", "Continue")], [local("new", "Continue", "old")])).toEqual([
      "Continue",
      "Continue",
    ]);
  });

  it("keeps case and whitespace differences inside prompts distinct", () => {
    expect(texts([user("u1", "A  B")], [local("l1", "a b", null)])).toEqual(["A  B", "a b"]);
  });

  it("retires echoes and advances a pending send's local boundary to the host ID", () => {
    const pending = local("l2", "Continue", "l1");
    const remaining = reconcileLiveUserMessages(
      [user("u1", "Continue")],
      [local("l1", "Continue", null), pending],
    );
    expect(remaining).toEqual([{ ...pending, optimisticAfterMessageId: "u1" }]);
    expect(texts([user("u1", "Continue")], remaining)).toEqual(["Continue", "Continue"]);
    expect(texts([], remaining)).toEqual(["Continue"]);
  });

  it("reconciles a host echo before the snapshot refresh", () => {
    const echo = user("u1", "Hello", 11);
    expect(reconcileLiveUserMessages([], [local("l1", "Hello", null), echo])).toEqual([echo]);
  });

  it("does not pair identical messages across threads", () => {
    const other = { ...user("u1", "Hello"), threadId: "other" };
    const pending = local("l1", "Hello", null);
    expect(reconcileLiveUserMessages([other], [pending])).toEqual([pending]);
  });

  it("matches uploaded attachment metadata and preserves a repeated attachment send", () => {
    const attachment = {
      id: "uploaded",
      type: "file" as const,
      name: "note.txt",
      sizeBytes: 2,
      mimeType: "text/plain",
      uri: "/uploaded",
    };
    const host = { ...user("u1", ""), attachments: [attachment] };
    const first = {
      ...local("l1", "", null),
      attachments: [{ ...attachment, id: "local", uri: "/local" }],
    };
    const next = { ...first, id: "l2", optimisticAfterMessageId: "l1" };
    expect(buildTranscriptItems([host], [first, next])).toHaveLength(2);
  });
});
