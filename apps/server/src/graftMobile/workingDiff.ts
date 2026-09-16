import type { GraftDiffSummary } from "@graft/mobile-contract";
import type { GitStatusResult } from "@graft/contracts";

export function mobileWorkingDiff(
  threadId: string,
  workingTree: GitStatusResult["workingTree"],
  porcelain: string,
): GraftDiffSummary {
  const statuses = new Map<string, GraftDiffSummary["files"][number]["status"]>();
  const records = porcelain.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const code = record.slice(0, 2);
    const path = record.slice(3);
    statuses.set(
      path,
      code.includes("R")
        ? "renamed"
        : code.includes("D")
          ? "deleted"
          : code.includes("A") || code === "??"
            ? "added"
            : "modified",
    );
    // NUL status puts the rename destination first, then the original path.
    if (code.includes("R") || code.includes("C")) index += 1;
  }
  return {
    id: threadId,
    threadId,
    title: "Working changes",
    files: workingTree.files.map((file) => ({
      path: file.path,
      status: statuses.get(file.path) ?? "modified",
      additions: file.insertions,
      deletions: file.deletions,
    })),
    updatedAt: Date.now(),
  };
}
