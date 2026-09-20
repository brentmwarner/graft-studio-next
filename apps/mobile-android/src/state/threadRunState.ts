import type { GraftRunStatus, GraftRunSummary, GraftTimelineEvent } from "@graft/mobile-contract";

const RUN_IS_ACTIVE: Record<GraftRunStatus, boolean> = {
  queued: true,
  running: true,
  waiting: true,
  completed: false,
  failed: false,
  cancelled: false,
};

/** Apply live lifecycle events immediately, without waiting for the HTTP snapshot. */
export function threadRunState(
  activeRun: GraftRunSummary | undefined,
  events: readonly GraftTimelineEvent[],
  snapshotCursor: number,
  threadIsRunning: boolean,
) {
  let activeRunId = activeRun && RUN_IS_ACTIVE[activeRun.status] ? activeRun.id : undefined;
  let isWorking = Boolean(activeRunId) || threadIsRunning;
  for (const event of events) {
    if (event.cursor <= snapshotCursor || event.kind !== "run.status" || !event.runStatus) continue;
    if (RUN_IS_ACTIVE[event.runStatus]) {
      activeRunId = event.runId ?? activeRunId;
      isWorking = true;
    } else if (!event.runId || event.runId === activeRunId) {
      // Session completion may omit runId after the host clears activeTurnId.
      // Otherwise, only a known matching run can clear the thread's working state.
      activeRunId = undefined;
      isWorking = false;
    }
  }
  return { activeRunId, isWorking };
}
