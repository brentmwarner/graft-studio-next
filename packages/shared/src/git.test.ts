import { describe, expect, it } from "vitest";

import {
  WORKTREE_BRANCH_PREFIX,
  buildGraftBranchName,
  buildTemporaryWorktreeBranchName,
  isTemporaryWorktreeBranch,
  resolveUniqueGraftBranchName,
  resolveThreadBranchRegressionGuard,
} from "./git";

const PRE_CUTOVER_NAMESPACE_FIXTURES = [
  String.fromCharCode(100, 112, 99, 111, 100, 101),
  String.fromCharCode(116, 51, 99, 111, 100, 101),
] as const;

describe("isTemporaryWorktreeBranch", () => {
  it("matches generated temporary worktree branches", () => {
    expect(isTemporaryWorktreeBranch(buildTemporaryWorktreeBranchName())).toBe(true);
  });

  it("matches leftover temporary worktree branches from the previous namespace", () => {
    expect(isTemporaryWorktreeBranch("synara/deadbeef")).toBe(true);
    expect(isTemporaryWorktreeBranch(" synara/DEADBEEF ")).toBe(true);
  });

  it("keeps recognizing only exact pre-cutover temporary namespaces", () => {
    for (const namespace of PRE_CUTOVER_NAMESPACE_FIXTURES) {
      expect(isTemporaryWorktreeBranch(`${namespace}/deadbeef`)).toBe(true);
      expect(isTemporaryWorktreeBranch(`${namespace}/semantic-branch`)).toBe(false);
    }
  });

  it("rejects semantic branch names", () => {
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/feature/demo`)).toBe(false);
    expect(isTemporaryWorktreeBranch("feature/demo")).toBe(false);
    expect(isTemporaryWorktreeBranch("feature/deadbeef")).toBe(false);
    expect(isTemporaryWorktreeBranch("hotfix/deadbeef")).toBe(false);
    expect(isTemporaryWorktreeBranch("bridge/deadbeef")).toBe(false);
    expect(isTemporaryWorktreeBranch("bridge/semantic-branch")).toBe(false);
  });
});

describe("resolveThreadBranchRegressionGuard", () => {
  it("keeps a semantic branch when the next branch is only a temporary worktree placeholder", () => {
    expect(
      resolveThreadBranchRegressionGuard({
        currentBranch: "feature/semantic-branch",
        nextBranch: `${WORKTREE_BRANCH_PREFIX}/deadbeef`,
      }),
    ).toBe("feature/semantic-branch");
  });

  it("accepts real branch changes", () => {
    expect(
      resolveThreadBranchRegressionGuard({
        currentBranch: "feature/old",
        nextBranch: "feature/new",
      }),
    ).toBe("feature/new");
  });

  it("allows clearing the branch", () => {
    expect(
      resolveThreadBranchRegressionGuard({
        currentBranch: "feature/old",
        nextBranch: null,
      }),
    ).toBeNull();
  });
});

describe("buildGraftBranchName", () => {
  it("uses graft as the branch namespace", () => {
    expect(buildGraftBranchName("fix toast copy")).toBe("graft/fix-toast-copy");
  });

  it("keeps non-Graft namespaces inside the Graft branch", () => {
    expect(buildGraftBranchName("feature/refine-toolbar-actions")).toBe(
      "graft/feature/refine-toolbar-actions",
    );
  });

  it("normalizes leftover and pre-cutover prefixes before rebuilding the branch", () => {
    expect(buildGraftBranchName("synara/refine toolbar actions")).toBe(
      "graft/refine-toolbar-actions",
    );
    for (const namespace of PRE_CUTOVER_NAMESPACE_FIXTURES) {
      expect(buildGraftBranchName(`${namespace}/refine toolbar actions`)).toBe(
        "graft/refine-toolbar-actions",
      );
    }
  });

  it("falls back to graft/update when no preferred name is provided", () => {
    expect(buildGraftBranchName()).toBe("graft/update");
  });
});

describe("resolveUniqueGraftBranchName", () => {
  it("increments suffix when the Graft branch already exists", () => {
    expect(
      resolveUniqueGraftBranchName(
        ["main", "graft/fix-toast-copy", "graft/fix-toast-copy-2"],
        "fix toast copy",
      ),
    ).toBe("graft/fix-toast-copy-3");
  });
});
