import type { TranscriptItem } from "../../state/mobileViewModels";

/** Fold settled work, keeping the final answer and structured results in place. */
export function presentTranscript(
  items: readonly TranscriptItem[],
  isTurnActive: boolean,
): readonly TranscriptItem[] {
  const result: TranscriptItem[] = [];
  let turn: TranscriptItem[] = [];

  function finish(active: boolean) {
    const final = turn.findLast((item) => item.kind === "assistant" && item.text.trim());
    // A failed/cancelled turn without an answer must retain its visible work.
    if (active || !final || final.kind !== "assistant") {
      result.push(...turn);
      turn = [];
      return;
    }
    const folded = turn.flatMap((item): TranscriptItem[] => {
      if (item === final) return [];
      if (item.kind === "toolGroup") return [...item.tools];
      if (item.kind === "tool" || item.kind === "assistant") return [item];
      return [];
    });
    for (const item of turn) {
      if (item === final) {
        result.push(folded.length ? { ...final, foldedActivity: folded } : final);
      } else if (item.kind !== "assistant" && item.kind !== "tool" && item.kind !== "toolGroup") {
        result.push(item);
      }
    }
    turn = [];
  }

  for (const item of items) {
    if (item.kind === "user") {
      finish(false);
      result.push(item);
    } else {
      turn.push(item);
    }
  }
  finish(isTurnActive);
  return result;
}
