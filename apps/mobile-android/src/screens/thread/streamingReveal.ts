/**
 * Graft's IDE-style streaming reveal.
 *
 * The host sends cumulative snapshots, which can arrive in visibly large
 * jumps for providers such as Codex. The renderer drains those snapshots at a
 * steady, word-aware cadence so provider batching never changes how the reply
 * feels on screen. Keep these values aligned with desktop `revealText.ts` and
 * iOS `StreamingReveal`.
 */

export const STREAM_REVEAL_COMMIT_MS = 40;
export const STREAM_REVEAL_MAX_CHARS = 20_000;

const MAX_BOUNDARY_LOOKAHEAD = 40;
const WHITESPACE_RE = /\s/;

export function initialStreamingRevealContent(
  content: string,
  streaming: boolean,
  reduceMotion: boolean,
): string {
  return streaming && !reduceMotion && content.length <= STREAM_REVEAL_MAX_CHARS ? "" : content;
}

export function advanceToWordBoundary(text: string, index: number): number {
  if (index >= text.length) return text.length;
  if (index <= 0) return 0;
  if (WHITESPACE_RE.test(text[index] ?? "") || WHITESPACE_RE.test(text[index - 1] ?? "")) {
    return index;
  }

  const limit = Math.min(text.length, index + MAX_BOUNDARY_LOOKAHEAD);
  for (let cursor = index + 1; cursor < limit; cursor += 1) {
    if (WHITESPACE_RE.test(text[cursor] ?? "")) return cursor;
  }
  return limit === text.length ? text.length : index;
}

export function nextStreamingRevealLength(
  text: string,
  currentLength: number,
  elapsedMs: number,
): number {
  if (currentLength >= text.length) return text.length;
  const remaining = text.length - currentLength;
  const charactersPerSecond = 170 + 4 * Math.max(0, remaining - 90);
  const step = Math.max(
    1,
    Math.min(600, Math.round((Math.min(200, elapsedMs) / 1_000) * charactersPerSecond)),
  );
  return advanceToWordBoundary(text, Math.min(text.length, currentLength + step));
}
