import { describe, expect, it, vi } from "vitest";
import { Effect, Layer } from "effect";
import { ThreadId, TurnId, CheckpointRef, type OrchestrationCheckpointSummary } from "@synara/contracts";
import { GraftDiffSummarySchema } from "@graft/mobile-contract";

import { CheckpointDiffQuery } from "../checkpointing/Services/CheckpointDiffQuery";
import { loadMobileDiff, mobilePatchFile } from "./diff";

const patch = `diff --git a/package.json b/package.json
index 1234567..abcdef0 100644
--- a/package.json
+++ b/package.json
@@ -20,4 +20,5 @@
   "effect": "catalog:",
   "electron": "43.4.1",
-  "ws": "^8.21.0"
+  "ws": "^8.21.0",
+  "@graft/mobile-contract": "workspace:*"
 }
@@ -33 +34 @@
-  "vitest": "old"
+  "vitest": "catalog:"
`;
const summary = { path: "package.json", status: "modified" as const, additions: 3, deletions: 2 };
const checkpoint: OrchestrationCheckpointSummary = {
  turnId: TurnId.makeUnsafe("turn-1"), checkpointTurnCount: 1, checkpointRef: CheckpointRef.makeUnsafe("refs/graft/test"),
  status: "ready", files: [{ ...summary, kind: "modified" }], assistantMessageId: null, completedAt: "2026-09-14T00:00:00.000Z",
};

describe("mobile patch files", () => {
  it("preserves both line-number sequences, context gaps, and syntax text", async () => {
    const file = await Effect.runPromise(mobilePatchFile(summary, patch));
    expect(file.detailStatus).toBe("ready");
    expect(file.hunks?.[0]?.collapsedBefore).toBe(19);
    expect(file.hunks?.[0]?.lines.map(({ kind, oldLine, newLine }) => [kind, oldLine, newLine])).toEqual([
      ["context", 20, 20], ["context", 21, 21], ["deletion", 22, undefined],
      ["addition", undefined, 22], ["addition", undefined, 23], ["context", 23, 24],
    ]);
    expect(file.hunks?.[1]?.collapsedBefore).toBe(9);
    expect(file.hunks?.[0]?.lines[3]?.tokens?.filter((token) => token.changed).map((token) => token.text).join("")).toBe(",");
    for (const line of file.hunks?.flatMap((hunk) => hunk.lines) ?? []) expect(line.tokens?.map((token) => token.text).join("")).toBe(line.text);
    expect(file.hunks?.[0]?.lines[0]?.tokens?.some((token) => token.lightColor && token.darkColor)).toBe(true);
  });
  it("emphasizes the changed characters of an isolated replacement", async () => {
    const file = await Effect.runPromise(mobilePatchFile(summary, patch.replace('+  "@graft/mobile-contract": "workspace:*"\n', '').replace('@@ -20,4 +20,5 @@', '@@ -20,4 +20,4 @@')));
    expect(file.hunks?.[0]?.lines.find((line) => line.kind === "addition")?.tokens?.filter((token) => token.changed).map((token) => token.text).join("")).toBe(",");
  });
  it("handles added files without inventing old line zero", async () => {
    const file = await Effect.runPromise(mobilePatchFile({ path: "hello.ts", status: "added" }, 'diff --git a/hello.ts b/hello.ts\nnew file mode 100644\n--- /dev/null\n+++ b/hello.ts\n@@ -0,0 +1,2 @@\n+export const hello = 1;\n+\n'));
    expect(file.hunks?.[0]?.lines.map((line) => [line.oldLine, line.newLine])).toEqual([[undefined, 1], [undefined, 2]]);
    expect(GraftDiffSummarySchema.safeParse({ id: "a", threadId: "a", updatedAt: 1, files: [file] }).success).toBe(true);
  });
  it("handles deletion and pure rename", async () => {
    const deleted = await Effect.runPromise(mobilePatchFile({ path: "old.txt", status: "deleted" }, 'diff --git a/old.txt b/old.txt\ndeleted file mode 100644\n--- a/old.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n'));
    expect(deleted.hunks?.[0]?.lines[0]).toMatchObject({ kind: "deletion", oldLine: 1 });
    const renamed = await Effect.runPromise(mobilePatchFile({ path: "new.txt", status: "renamed" }, 'diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n'));
    expect(renamed).toMatchObject({ previousPath: "old.txt", hunks: [], detailStatus: "ready" });
  });
  it("bounds a huge file and marks the preview as truncated", async () => {
    const file = await Effect.runPromise(mobilePatchFile({ path: "huge.txt", status: "added" }, `diff --git a/huge.txt b/huge.txt\n--- /dev/null\n+++ b/huge.txt\n@@ -0,0 +1,1500 @@\n${Array.from({ length: 1500 }, (_, i) => `+line ${i}\n`).join("")}`));
    expect(file.detailStatus).toBe("truncated");
    expect(file.hunks?.flatMap((hunk) => hunk.lines)).toHaveLength(1200);
  });
  it("does not compute patches for summaries or paths outside the checkpoint", async () => {
    const query = vi.fn(() => Effect.die("must not query"));
    const layer = Layer.succeed(CheckpointDiffQuery, { getTurnDiff: query, getFullThreadDiff: query });
    await Effect.runPromise(loadMobileDiff("t", checkpoint).pipe(Effect.provide(layer)));
    await Effect.runPromise(loadMobileDiff("t", checkpoint, "../private").pipe(Effect.provide(layer)));
    expect(query).not.toHaveBeenCalled();
  });
  it("reads the matching turn with whitespace changes included", async () => {
    const query = vi.fn(() => Effect.succeed({ threadId: ThreadId.makeUnsafe("t"), fromTurnCount: 0, toTurnCount: 1, diff: patch }));
    const layer = Layer.succeed(CheckpointDiffQuery, { getTurnDiff: query, getFullThreadDiff: query });
    const result = await Effect.runPromise(loadMobileDiff("t", checkpoint, "package.json").pipe(Effect.provide(layer)));
    expect(query).toHaveBeenCalledWith({ threadId: "t", fromTurnCount: 0, toTurnCount: 1, ignoreWhitespace: false });
    expect(GraftDiffSummarySchema.safeParse(result).success).toBe(true);
    expect(result.files[0]?.detailStatus).toBe("ready");
  });
});
