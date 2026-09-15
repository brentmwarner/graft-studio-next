import type {
  GraftDiffFileSummary,
  GraftDiffHunk,
  GraftDiffLine,
  GraftDiffSummary,
} from "@graft/mobile-contract";
import type { FileDiffMetadata } from "@pierre/diffs";
import { ThreadId, type OrchestrationCheckpointSummary } from "@graft/contracts";
import { Effect } from "effect";

import { loadDiffTools } from "../checkpointing/Diffs";
import { CheckpointDiffQuery } from "../checkpointing/Services/CheckpointDiffQuery";
import { toMobileDiff } from "./protocolAdapter";

const MAX_FILE_LINES = 1_200;
const MAX_FILE_CHARS = 180_000;

function cleanLine(text: string): string {
  return text.replace(/\r?\n$/, "");
}

/** Line numbers come from the patch's two coordinate systems, including zero-count hunks. */
export function mobileFileHunks(file: FileDiffMetadata): GraftDiffHunk[] {
  return file.hunks.map((hunk) => {
    let oldLine = hunk.deletionStart;
    let newLine = hunk.additionStart;
    const lines: GraftDiffLine[] = [];
    for (const content of hunk.hunkContent) {
      switch (content.type) {
        case "context":
          for (let index = 0; index < content.lines; index += 1) {
            lines.push({
              kind: "context",
              text: cleanLine(file.additionLines[content.additionLineIndex + index] ?? ""),
              oldLine: oldLine++,
              newLine: newLine++,
            });
          }
          break;
        case "change":
          for (let index = 0; index < content.deletions; index += 1) {
            lines.push({
              kind: "deletion",
              text: cleanLine(file.deletionLines[content.deletionLineIndex + index] ?? ""),
              oldLine: oldLine++,
            });
          }
          for (let index = 0; index < content.additions; index += 1) {
            lines.push({
              kind: "addition",
              text: cleanLine(file.additionLines[content.additionLineIndex + index] ?? ""),
              newLine: newLine++,
            });
          }
          break;
        default: {
          const exhaustive: never = content;
          return exhaustive;
        }
      }
    }
    return {
      oldStart: hunk.deletionStart,
      newStart: hunk.additionStart,
      collapsedBefore: hunk.collapsedBefore,
      lines,
    };
  });
}

function boundedHunks(hunks: GraftDiffHunk[]) {
  let remainingLines = MAX_FILE_LINES;
  let remainingChars = MAX_FILE_CHARS;
  let truncated = false;
  const result: GraftDiffHunk[] = [];
  for (const hunk of hunks) {
    const lines: GraftDiffLine[] = [];
    for (const line of hunk.lines) {
      if (remainingLines <= 0 || line.text.length > remainingChars) {
        truncated = true;
        break;
      }
      remainingLines -= 1;
      remainingChars -= line.text.length;
      lines.push(line);
    }
    if (lines.length > 0) result.push({ ...hunk, lines });
    if (truncated) break;
  }
  return { hunks: result, truncated };
}

/** Pair replacement rows without highlighting unrelated additions in the same change block. */
function changedRanges(lines: GraftDiffLine[]): Map<GraftDiffLine, readonly [number, number]> {
  const ranges = new Map<GraftDiffLine, readonly [number, number]>();
  for (let index = 0; index < lines.length; ) {
    if (lines[index]?.kind !== "deletion") {
      index += 1;
      continue;
    }
    const removed: GraftDiffLine[] = [];
    const added: GraftDiffLine[] = [];
    while (lines[index]?.kind === "deletion") removed.push(lines[index++]!);
    while (lines[index]?.kind === "addition") added.push(lines[index++]!);
    for (let pair = 0; pair < Math.min(removed.length, added.length); pair += 1) {
      const before = removed[pair]!;
      const after = added[pair]!;
      let start = 0;
      while (
        start < Math.min(before.text.length, after.text.length) &&
        before.text[start] === after.text[start]
      )
        start += 1;
      let suffix = 0;
      while (
        suffix < Math.min(before.text.length, after.text.length) - start &&
        before.text.at(-suffix - 1) === after.text.at(-suffix - 1)
      )
        suffix += 1;
      if (start + suffix < Math.max(before.text.length, after.text.length) / 2) continue;
      ranges.set(before, [start, before.text.length - suffix]);
      ranges.set(after, [start, after.text.length - suffix]);
    }
  }
  return ranges;
}

export const mobilePatchFile = Effect.fn(function* (summary: GraftDiffFileSummary, patch: string) {
  const tools = yield* loadDiffTools();
  const parsed = yield* Effect.try({
    try: () => tools.parsePatchFiles(patch),
    catch: (cause) => new Error("Could not parse the patch", { cause }),
  });
  const file = parsed.flatMap((entry) => entry.files).find((entry) => entry.name === summary.path);
  if (!file) return { ...summary, detailStatus: "unavailable" as const };
  const { hunks, truncated } = boundedHunks(mobileFileHunks(file));
  const lines = hunks.flatMap((hunk) => hunk.lines);
  const lang = tools.getFiletypeFromFileName(file.name);
  // Highlight each version independently so removed lines don't corrupt the new file's lexer state.
  const highlight = Effect.tryPromise({
    try: async () => {
      const highlighter = await tools.getSharedHighlighter({
        themes: ["pierre-light", "pierre-dark"],
        langs: [lang],
      });
      const ranges = changedRanges(lines);
      for (const version of ["old", "new"] as const) {
        const versionLines = lines.filter((line) =>
          version === "old" ? line.kind !== "addition" : line.kind !== "deletion",
        );
        const tokens = highlighter.codeToTokensWithThemes(
          versionLines.map((line) => line.text).join("\n"),
          {
            lang,
            themes: { light: "pierre-light", dark: "pierre-dark" },
          },
        );
        versionLines.forEach((line, index) => {
          const range = ranges.get(line);
          let offset = 0;
          line.tokens = (tokens[index] ?? []).flatMap((token) => {
            const start = offset;
            offset += token.content.length;
            const cuts = [
              start,
              offset,
              ...(range ?? []).filter((cut) => cut > start && cut < offset),
            ].sort((a, b) => a - b);
            return cuts.slice(0, -1).map((cut, segment) => ({
              text: token.content.slice(cut - start, cuts[segment + 1]! - start),
              ...(token.variants.light?.color ? { lightColor: token.variants.light.color } : {}),
              ...(token.variants.dark?.color ? { darkColor: token.variants.dark.color } : {}),
              ...(range && cut >= range[0] && cut < range[1] ? { changed: true } : {}),
            }));
          });
        });
      }
    },
    catch: (cause) => new Error("Could not highlight the patch", { cause }),
  }).pipe(Effect.catch(() => Effect.void));
  if (lines.length > 0) yield* highlight;
  return {
    ...summary,
    ...(file.prevName ? { previousPath: file.prevName } : {}),
    hunks,
    detailStatus: truncated ? ("truncated" as const) : ("ready" as const),
  };
});

export const loadMobileDiff = Effect.fn(function* (
  threadId: string,
  checkpoint: OrchestrationCheckpointSummary | undefined,
  filePath?: string,
) {
  const summary = toMobileDiff(threadId, checkpoint);
  // Summaries stay cheap. A requested path is matched to a checkpoint, never read from disk directly.
  if (!filePath || !checkpoint) return summary;
  const requested = summary.files.find((file) => file.path === filePath);
  if (!requested) return summary;
  const query = yield* CheckpointDiffQuery;
  const detail = yield* query
    .getTurnDiff({
      threadId: ThreadId.makeUnsafe(threadId),
      fromTurnCount: Math.max(0, checkpoint.checkpointTurnCount - 1),
      toTurnCount: checkpoint.checkpointTurnCount,
      ignoreWhitespace: false,
    })
    .pipe(
      Effect.flatMap(({ diff }) => mobilePatchFile(requested, diff)),
      Effect.catch(() => Effect.succeed({ ...requested, detailStatus: "unavailable" as const })),
    );
  return {
    ...summary,
    files: summary.files.map((file) => (file.path === filePath ? detail : file)),
  } satisfies GraftDiffSummary;
});
