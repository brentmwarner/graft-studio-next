import type { GraftEnvironmentSnapshot, GraftTimelineEvent } from "@graft/mobile-contract";
import { describe, expect, it } from "vitest";

import { parseThreadReads, reconcileThreadReads, threadActivity } from "./threadActivity";

const thread = { id: "t", projectId: "p", title: "Reply", updatedAt: 100, status: "idle" as const };
const snapshot: GraftEnvironmentSnapshot = {
  environment: {
    id: "env",
    label: "Mac",
    hostVersion: "1",
    protocolVersion: 1,
    capabilities: [],
    cursor: 1,
  },
  projects: [],
  threads: [thread],
  activeRuns: [],
  pendingApprovals: [],
  pendingQuestions: [],
  selectedTranscript: null,
  cursor: 1,
};
const event = (
  kind: GraftTimelineEvent["kind"],
  extra: Partial<GraftTimelineEvent> = {},
): GraftTimelineEvent => ({
  id: kind,
  threadId: "t",
  runId: "r",
  kind,
  createdAt: 100,
  cursor: 1,
  ...extra,
});

describe("thread activity and unread receipts", () => {
  it("distinguishes working, requests, unread responses, and idle", () => {
    const reads = { t: { completedAt: 100, viewedAt: 0 } };
    expect(threadActivity(thread, snapshot)).toBe("idle");
    expect(threadActivity(thread, snapshot, reads)).toBe("unread");
    expect(threadActivity({ ...thread, status: "running" }, snapshot, reads)).toBe("working");
    expect(
      threadActivity(
        thread,
        {
          ...snapshot,
          activeRuns: [{ id: "r", threadId: "t", projectId: "p", status: "queued", startedAt: 90 }],
        },
        reads,
      ),
    ).toBe("working");
    expect(
      threadActivity(
        thread,
        {
          ...snapshot,
          pendingQuestions: [{ id: "q", threadId: "t", prompt: "Choose", createdAt: 90 }],
        },
        reads,
      ),
    ).toBe("needs_attention");
  });
  it("restores missed completions and makes marking viewed idempotent across replay", () => {
    const completed = { ...snapshot, threads: [{ ...thread, lastCompletedAt: 100 }] };
    const unread = reconcileThreadReads({}, completed, []);
    expect(unread.t).toEqual({ completedAt: 100, viewedAt: 0 });
    const read = reconcileThreadReads(unread, completed, [], "t");
    expect(read.t).toEqual({ completedAt: 100, viewedAt: 100 });
    expect(reconcileThreadReads(read, completed, [])).toBe(read);
    expect(
      reconcileThreadReads(
        read,
        { ...completed, threads: [{ ...thread, lastCompletedAt: 101 }] },
        [],
      ).t,
    ).toEqual({ completedAt: 101, viewedAt: 100 });
  });
  it("only marks successful live responses unread on older hosts", () => {
    const text = event("assistant.delta", { text: "Hello" });
    const done = event("run.status", { runStatus: "completed" });
    expect(reconcileThreadReads({}, snapshot, [text, done]).t?.completedAt).toBe(100);
    expect(reconcileThreadReads({}, snapshot, [done])).toEqual({});
    for (const runStatus of ["failed", "cancelled"] as const) {
      expect(
        reconcileThreadReads({}, snapshot, [text, event("run.status", { runStatus }), done]),
      ).toEqual({});
    }
    expect(reconcileThreadReads({}, snapshot, [text, event("error"), done])).toEqual({});
    expect(reconcileThreadReads({}, snapshot, [text, { ...done, runId: "other" }])).toEqual({});
  });
  it("ignores corrupt persisted receipts", () => {
    expect(parseThreadReads("invalid")).toEqual({});
    expect(parseThreadReads("[1]")).toEqual({});
    expect(
      parseThreadReads(
        '{"t":{"completedAt":5,"viewedAt":4},"bad":{"completedAt":-1,"viewedAt":0}}',
      ),
    ).toEqual({ t: { completedAt: 5, viewedAt: 4 } });
  });
});
