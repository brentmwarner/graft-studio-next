import type { GraftRunSummary, GraftTimelineEvent } from "@graft/mobile-contract";
import { expect, it } from "vitest";

import { threadRunState } from "./threadRunState";

const run: GraftRunSummary = {
  id: "run",
  threadId: "thread",
  projectId: "project",
  status: "running",
  startedAt: 1,
  title: "Task",
};
function status(
  cursor: number,
  runStatus: GraftTimelineEvent["runStatus"],
  runId?: string,
): GraftTimelineEvent {
  return {
    id: `s${cursor}`,
    cursor,
    kind: "run.status",
    threadId: "thread",
    runId,
    runStatus,
    createdAt: cursor,
  };
}

it("shows work immediately when the start event beats the snapshot", () => {
  expect(threadRunState(undefined, [status(2, "running", "run")], 1, false)).toEqual({
    activeRunId: "run",
    isWorking: true,
  });
});
it("keeps work visible when a running thread summary has no run yet", () => {
  expect(threadRunState(undefined, [], 1, true).isWorking).toBe(true);
});
it("handles completion without a run ID and does not wait for a snapshot", () => {
  expect(threadRunState(run, [status(2, "completed")], 1, true)).toEqual({
    activeRunId: undefined,
    isWorking: false,
  });
});
it("does not let a previous run's terminal event hide the current turn", () => {
  expect(threadRunState(run, [status(2, "completed", "old")], 1, true)).toEqual({
    activeRunId: "run",
    isWorking: true,
  });
});
it("does not resurrect a run from events already covered by the snapshot", () => {
  expect(threadRunState(undefined, [status(2, "running", "old")], 3, false).isWorking).toBe(false);
});
it("follows queued IDs into provider IDs through waiting and cancellation", () => {
  const events = [
    status(1, "queued", "command"),
    status(2, "running", "provider"),
    status(3, "waiting", "provider"),
  ];
  expect(threadRunState(undefined, events, 0, false)).toEqual({
    activeRunId: "provider",
    isWorking: true,
  });
  expect(
    threadRunState(undefined, [...events, status(4, "cancelled", "provider")], 0, false).isWorking,
  ).toBe(false);
});
