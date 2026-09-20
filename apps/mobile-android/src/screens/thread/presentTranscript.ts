import type { TranscriptItem } from "../../state/mobileViewModels";

type WorkItem = Extract<TranscriptItem, { kind: "assistant" | "tool" | "toolGroup" }>;

/** Fold settled work by run; a queued user message does not finish the active run. */
export function presentTranscript(
  items: readonly TranscriptItem[],
  isTurnActive: boolean,
  activeRunId?: string,
): readonly TranscriptItem[] {
  const turns = new Map<string, WorkItem[]>();
  const ownership = new Map<TranscriptItem, string>();
  let userBoundary = 0;
  let latestWork: string | undefined;
  for (const item of items) {
    if (item.kind === "user") {
      userBoundary += 1;
    } else if (item.kind === "assistant" || item.kind === "tool" || item.kind === "toolGroup") {
      // Older hosts can omit run IDs. Keep their user boundaries for settled
      // history, but do not infer completion from them while work is active.
      const key = item.runId ? `run:${item.runId}` : `user:${userBoundary}`;
      const turn = turns.get(key) ?? [];
      turn.push(item);
      turns.set(key, turn);
      ownership.set(item, key);
      latestWork = key;
    }
  }
  const activeKey = isTurnActive
    ? activeRunId && turns.has(`run:${activeRunId}`)
      ? `run:${activeRunId}`
      : latestWork
    : undefined;
  const replacements = new Map<TranscriptItem, TranscriptItem>();
  const foldedTurns = new Set<string>();
  for (const [key, turn] of turns) {
    if (key === activeKey || (isTurnActive && !key.startsWith("run:"))) continue;
    const final = turn.findLast((item) => item.kind === "assistant" && item.text.trim());
    // Failed/cancelled turns without an answer retain their visible work.
    if (!final || final.kind !== "assistant") continue;
    const folded = turn.flatMap((item): readonly TranscriptItem[] => {
      if (item === final) return [];
      return item.kind === "toolGroup" ? item.tools : [item];
    });
    foldedTurns.add(key);
    replacements.set(final, folded.length ? { ...final, foldedActivity: folded } : final);
  }
  return items.flatMap((item): TranscriptItem[] => {
    const replacement = replacements.get(item);
    if (replacement) return [replacement];
    const key = ownership.get(item);
    return key && foldedTurns.has(key) ? [] : [item];
  });
}
