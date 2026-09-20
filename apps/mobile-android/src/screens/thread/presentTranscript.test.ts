import type { GraftTimelineEvent } from "@graft/mobile-contract";
import { expect, it } from "vitest";

import {
  buildTranscriptItems,
  reconcileTranscriptItems,
  type TranscriptItem,
} from "../../state/mobileViewModels";
import { transcriptFollowContent } from "../../state/transcriptFollow";
import { threadRunState } from "../../state/threadRunState";
import { presentTranscript } from "./presentTranscript";

const user: TranscriptItem = { id: "u", kind: "user", text: "Fix it", runId: "first" };
const thought: TranscriptItem = {
  id: "r",
  kind: "assistant",
  runId: "first",
  text: "",
  reasoning: "Checking",
  streaming: false,
};
const note: TranscriptItem = {
  id: "n",
  kind: "assistant",
  runId: "first",
  text: "I found the issue",
  reasoning: "",
  streaming: false,
};
const tool: TranscriptItem = {
  id: "t",
  kind: "tool",
  runId: "first",
  toolId: "t",
  name: "Working",
  detail: "Checked",
  running: false,
};
const answer: TranscriptItem = {
  id: "a",
  kind: "assistant",
  runId: "first",
  text: "Fixed **it**.",
  reasoning: "",
  streaming: false,
};
const error: TranscriptItem = { id: "e", kind: "error", text: "A check failed" };
const activity: TranscriptItem = { id: "f", kind: "activity", eventId: "f", text: "Changed file" };
const rows = [user, thought, note, tool, activity, answer, error];

it("keeps the final answer, errors and structured results visible while folding all work", () => {
  const presented = presentTranscript(rows, false);
  expect(presented.map((item) => item.id)).toEqual(["u", "f", "a", "e"]);
  expect(presented[2]).toEqual({ ...answer, foldedActivity: [thought, note, tool] });
});
it("leaves the active turn and interrupted turns without an answer intact", () => {
  expect(presentTranscript(rows, true)).toEqual(rows);
  const interrupted = [user, thought, tool, error];
  expect(presentTranscript(interrupted, false)).toEqual(interrupted);
});
it("folds older turns while another response is streaming and flattens tool groups", () => {
  const group: TranscriptItem = {
    id: "g",
    kind: "toolGroup",
    runId: "first",
    tools: [tool, { ...tool, id: "t2" }],
  };
  const active = { ...answer, id: "next", runId: "next", streaming: true };
  const result = presentTranscript([user, group, answer, { ...user, id: "u2" }, active], true);
  expect(result[1]).toEqual({ ...answer, foldedActivity: group.tools });
  expect(result.at(-1)).toBe(active);
});
it("does not mutate the raw text used for follow decisions when a turn folds", () => {
  const before = transcriptFollowContent(rows);
  presentTranscript(rows, false);
  expect(transcriptFollowContent(rows)).toEqual(before);
  expect(answer).not.toHaveProperty("foldedActivity");
});

it("keeps settled folded rows memoized during later streaming but refreshes changed work", () => {
  const settled = presentTranscript(rows, false);
  const active = { ...answer, id: "next", runId: "next", streaming: true };
  const next = reconcileTranscriptItems(
    settled,
    presentTranscript([...rows, { ...user, id: "u2" }, active], true),
  );
  expect(next.find((item) => item.id === answer.id)).toBe(
    settled.find((item) => item.id === answer.id),
  );
  const changed = reconcileTranscriptItems(
    settled,
    presentTranscript([user, { ...tool, detail: "Updated result" }, answer], false),
  );
  expect(changed.at(-1)).not.toBe(settled.find((item) => item.id === answer.id));
});

const event = (
  id: string,
  kind: GraftTimelineEvent["kind"],
  text: string,
  runId?: string,
): GraftTimelineEvent => ({
  id,
  kind,
  text,
  runId,
  toolId: id,
  threadId: "thread",
  cursor: 0,
  createdAt: 1,
});

it("keeps active work visible across a queued prompt and associates later deltas with that run", () => {
  const events = [
    event("old-user", "user.message", "Previous prompt", "old"),
    event("old-tool", "tool.end", "Previous work", "old"),
    event("old-answer", "assistant.message", "Previous answer", "old"),
    event("current-user", "user.message", "Current prompt", "current"),
    event("commentary", "assistant.message", "Checking", "current"),
    event("tool", "tool.end", "Checked", "current"),
    event("queued", "user.message", "Follow up"),
  ];
  const before = presentTranscript(buildTranscriptItems([], events), true, "current");
  expect(before.find((item) => item.id === "assistant:old-answer")).toHaveProperty(
    "foldedActivity",
  );
  expect(before.find((item) => item.id === "assistant:commentary")).not.toHaveProperty(
    "foldedActivity",
  );
  expect(before.find((item) => item.id === "tool:current:tool")).toBeDefined();
  const appended = [...events, event("answer", "assistant.delta", "Current answer", "current")];
  const active = presentTranscript(buildTranscriptItems([], appended), true, "current");
  const queuedState = threadRunState(
    { id: "current", threadId: "thread", status: "running", startedAt: 1 },
    [
      {
        ...event("queued-status", "run.status", "", "queued-command"),
        cursor: 20,
        runStatus: "queued",
      },
    ],
    0,
    true,
  );
  expect(queuedState.activeRunId).toBe("queued-command");
  expect(
    presentTranscript(
      buildTranscriptItems([], appended),
      queuedState.isWorking,
      queuedState.activeRunId,
    ),
  ).toEqual(active);
  expect(active.filter((item) => item.runId === "current")).toEqual(
    buildTranscriptItems([], appended).filter((item) => item.runId === "current"),
  );
  const completed = presentTranscript(
    buildTranscriptItems(
      [],
      [
        ...appended,
        event("answer", "assistant.message", "Current answer complete", "current"),
        event("new-answer", "assistant.delta", "Following up", "next"),
      ],
    ),
    true,
    "next",
  );
  expect(completed.find((item) => item.id === "assistant:answer")).toMatchObject({
    text: "Current answer complete",
    foldedActivity: [
      expect.objectContaining({ id: "assistant:commentary", runId: "current" }),
      expect.objectContaining({ kind: "tool", runId: "current" }),
    ],
  });
  expect(completed.find((item) => item.id === "assistant:new-answer")).not.toHaveProperty(
    "foldedActivity",
  );
  expect(completed.find((item) => item.id === "user:queued")).toBeDefined();
});

it("does not treat a queued user row alone as completion on a host without run IDs", () => {
  const queued = { ...user, id: "queued", runId: undefined };
  const legacy = rows.map((item) => Object.assign({}, item, { runId: undefined }));
  const laterDelta = { ...answer, id: "later", streaming: true, runId: undefined };
  expect(presentTranscript([...legacy, queued], true)).toEqual([...legacy, queued]);
  expect(presentTranscript([...legacy, queued, laterDelta], true)).toEqual([
    ...legacy,
    queued,
    laterDelta,
  ]);
});

it("does not group adjacent tools from different runs", () => {
  const events: GraftTimelineEvent[] = ["current", "next"].map((runId) => ({
    id: runId,
    runId,
    kind: "tool.end",
    text: "Checked",
    cursor: 0,
    threadId: "thread",
    createdAt: 1,
  }));
  expect(buildTranscriptItems([], events).map((item) => [item.kind, item.runId])).toEqual([
    ["tool", "current"],
    ["tool", "next"],
  ]);
});

it("updates row ownership when a snapshot adds a run ID", () => {
  const current = { ...answer, runId: "current" };
  expect(reconcileTranscriptItems([answer], [current])[0]).toBe(current);
});

it("adopts a run ID supplied by a later frame of the same assistant message", () => {
  const delta: GraftTimelineEvent = {
    id: "answer",
    kind: "assistant.delta",
    text: "Starting",
    cursor: 1,
    threadId: "thread",
    createdAt: 1,
  };
  const queued: GraftTimelineEvent = {
    ...delta,
    id: "queued",
    kind: "user.message",
    text: "Next",
    cursor: 2,
  };
  const completed: GraftTimelineEvent = {
    ...delta,
    kind: "assistant.message",
    text: "Done",
    cursor: 3,
    runId: "current",
  };
  const built = buildTranscriptItems([], [delta, queued, completed]);
  expect(built[0]).toMatchObject({ id: "assistant:answer", text: "Done", runId: "current" });
  expect(presentTranscript(built, true, "current")).toEqual(built);
});
