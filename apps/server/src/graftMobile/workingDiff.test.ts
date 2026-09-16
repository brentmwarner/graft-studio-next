import { describe, expect, it } from "vitest";

import { mobileWorkingDiff } from "./workingDiff";

describe("mobile working changes", () => {
  it("keeps binary, rename and mode-only changes without invented line counts", () => {
    const files = ["new image.png", "renamed\nfile.txt", "mode.sh", "deleted.ts"].map((path) => ({
      path,
      insertions: 0,
      deletions: 0,
    }));
    const diff = mobileWorkingDiff(
      "thread",
      { files, insertions: 0, deletions: 0 },
      "?? new image.png\0R  renamed\nfile.txt\0old file.txt\0 M mode.sh\0 D deleted.ts\0",
    );
    expect(diff.files.map((file) => file.status)).toEqual([
      "added",
      "renamed",
      "modified",
      "deleted",
    ]);
    expect(diff.files).toHaveLength(4);
    expect(diff.runId).toBeUndefined();
  });
  it("returns an empty summary once the working tree is clean", () => {
    expect(
      mobileWorkingDiff("thread", { files: [], insertions: 0, deletions: 0 }, "").files,
    ).toEqual([]);
  });
});
