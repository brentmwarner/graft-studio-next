import type {
  GraftEnvironmentSnapshot,
  GraftThreadSummary,
  GraftTimelineEvent,
} from "@graft/mobile-contract";

export type ThreadActivity = "idle" | "working" | "unread" | "needs_attention";
export interface ThreadReadReceipt {
  readonly completedAt: number;
  readonly viewedAt: number;
}
export type ThreadReadState = Readonly<Record<string, ThreadReadReceipt>>;

export function reconcileThreadReads(
  previous: ThreadReadState,
  snapshot: GraftEnvironmentSnapshot | null,
  events: readonly GraftTimelineEvent[],
  visibleThreadId?: string,
): ThreadReadState {
  let next = previous;
  function complete(id: string, completedAt: number) {
    if (!Number.isFinite(completedAt) || completedAt <= (next[id]?.completedAt ?? 0)) return;
    next = { ...next, [id]: { completedAt, viewedAt: next[id]?.viewedAt ?? 0 } };
  }
  for (const thread of snapshot?.threads ?? []) {
    if (thread.lastCompletedAt !== undefined) complete(thread.id, thread.lastCompletedAt);
  }
  // Legacy session-ready events can look like completions. Require actual
  // assistant text in that live turn, and clear it on failure/cancellation.
  const answers = new Map<string, string | undefined>();
  for (const event of events) {
    const id = event.threadId;
    if (!id) continue;
    if (
      (event.kind === "assistant.delta" || event.kind === "assistant.message") &&
      event.text?.trim()
    )
      answers.set(id, event.runId);
    if (event.kind !== "run.status" && event.kind !== "error") continue;
    if (event.runId && answers.get(id) && event.runId !== answers.get(id)) continue;
    if (event.runStatus === "completed" && answers.has(id))
      complete(id, event.completedAt ?? event.createdAt);
    if (
      event.kind === "error" ||
      event.runStatus === "completed" ||
      event.runStatus === "failed" ||
      event.runStatus === "cancelled"
    )
      answers.delete(id);
  }
  const receipt = visibleThreadId ? next[visibleThreadId] : undefined;
  if (visibleThreadId && receipt && receipt.completedAt > receipt.viewedAt) {
    next = { ...next, [visibleThreadId]: { ...receipt, viewedAt: receipt.completedAt } };
  }
  return next;
}

export function threadActivity(
  thread: GraftThreadSummary,
  snapshot: GraftEnvironmentSnapshot,
  reads: ThreadReadState = {},
): ThreadActivity {
  if (
    thread.status === "needs_attention" ||
    snapshot.pendingApprovals.some((item) => item.threadId === thread.id) ||
    snapshot.pendingQuestions.some((item) => item.threadId === thread.id)
  )
    return "needs_attention";
  if (
    thread.status === "running" ||
    snapshot.activeRuns.some(
      (run) => run.threadId === thread.id && (run.status === "running" || run.status === "queued"),
    )
  )
    return "working";
  const receipt = reads[thread.id];
  if (receipt && receipt.completedAt > receipt.viewedAt) return "unread";
  return "idle";
}

export function parseThreadReads(value: string | null): ThreadReadState {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, record]) => {
        if (!record || typeof record !== "object") return false;
        const { completedAt, viewedAt } = record;
        return (
          typeof completedAt === "number" &&
          Number.isFinite(completedAt) &&
          completedAt >= 0 &&
          typeof viewedAt === "number" &&
          Number.isFinite(viewedAt) &&
          viewedAt >= 0
        );
      }),
    );
  } catch {
    return {};
  }
}
