import { GraftMobileCommandSchema, type GraftMobileCommand } from "@graft/mobile-contract";
import { ProjectId, ThreadId } from "@graft/contracts";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it, vi } from "vitest";

import { ServerConfig } from "../config";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment";
import { GitCore } from "../git/Services/GitCore";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { ProviderDiscoveryService } from "../provider/Services/ProviderDiscoveryService";
import { ServerSettingsService } from "../serverSettings";
import { WorkspaceEntries } from "../workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "../workspace/Services/WorkspaceFileSystem";
import { executeMobileCommand, makeGraftMobileGatewayState } from "./gateway";

function harness({ missing = false, gitFails = false, isRepo = true, mutationFails = false } = {}) {
  const thread = {
    id: ThreadId.makeUnsafe("thread"),
    projectId: ProjectId.makeUnsafe("project"),
    title: "Original title",
    createdAt: "2026-09-20T12:00:00Z",
    updatedAt: "2026-09-23T12:00:00Z",
    envMode: "worktree",
    worktreePath: "/workspace/feature",
    branch: "stale-branch",
    modelSelection: { provider: "codex", model: "gpt-5.5" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    latestTurn: null,
  };
  const dispatch = vi.fn((command: { title: string }) => {
    if (mutationFails) return Effect.fail(new Error("Rename rejected"));
    thread.title = command.title;
    return Effect.succeed({ sequence: 7 });
  });
  const readBranchContext = vi.fn(() =>
    gitFails
      ? Effect.fail(new Error("Git offline"))
      : Effect.succeed({
          isRepo,
          branch: "feature/menu",
          upstreamBranch: "origin/feature/menu",
          aheadCount: 2,
          behindCount: 1,
        }),
  );
  const execute = vi.fn(() =>
    Effect.succeed({ stdout: "origin\tgit@github.com:team/repo.git (fetch)\n" }),
  );
  const services = Layer.mergeAll(
    Layer.succeed(OrchestrationEngineService, { dispatch } as never),
    Layer.succeed(ProjectionSnapshotQuery, {
      getThreadShellById: () => Effect.succeed(missing ? Option.none() : Option.some(thread)),
      getProjectShellById: () =>
        Effect.succeed(
          Option.some({ id: thread.projectId, title: "Project", workspaceRoot: "/workspace/repo" }),
        ),
      getShellSnapshot: () => Effect.succeed({ snapshotSequence: 7, threads: [thread] }),
    } as never),
    Layer.succeed(GitCore, { readBranchContext, execute } as never),
    Layer.succeed(ProviderDiscoveryService, {} as never),
    Layer.succeed(ServerConfig, {} as never),
    Layer.succeed(ServerEnvironment, {} as never),
    Layer.succeed(ServerSettingsService, {} as never),
    Layer.succeed(WorkspaceEntries, {} as never),
    Layer.succeed(WorkspaceFileSystem, {} as never),
  );
  return {
    thread,
    dispatch,
    readBranchContext,
    execute,
    run: (command: GraftMobileCommand) =>
      Effect.runPromise(
        executeMobileCommand(
          makeGraftMobileGatewayState(),
          "details-command",
          GraftMobileCommandSchema.parse(command),
        ).pipe(Effect.provide(services)),
      ),
  };
}

describe("mobile thread details and rename", () => {
  it("reads live Git metadata from the thread's worktree, not its stale stored branch", async () => {
    const test = harness();
    expect(await test.run({ type: "thread.details", threadId: "thread" })).toMatchObject({
      type: "thread.details.result",
      details: {
        thread: { id: "thread", title: "Original title" },
        workspaceName: "feature",
        gitStatus: "available",
        branch: "feature/menu",
      },
    });
    expect(test.readBranchContext).toHaveBeenCalledWith("/workspace/feature");
    expect(test.dispatch).not.toHaveBeenCalled();
  });
  it.each([
    { gitFails: true, expected: "unavailable" },
    { isRepo: false, expected: "not_repository" },
  ])("preserves thread metadata when Git is $expected", async ({ expected, ...options }) => {
    const test = harness(options);
    expect(await test.run({ type: "thread.details", threadId: "thread" })).toMatchObject({
      details: { thread: { title: "Original title" }, gitStatus: expected },
    });
    expect(test.execute).not.toHaveBeenCalled();
  });
  it("renames through orchestration and returns the confirmed projection", async () => {
    const test = harness();
    expect(
      await test.run({ type: "thread.rename", threadId: "thread", title: "  A better title  " }),
    ).toMatchObject({
      type: "thread.rename.result",
      thread: { id: "thread", title: "A better title" },
    });
    expect(test.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.meta.update",
        threadId: "thread",
        title: "A better title",
      }),
      undefined,
    );
  });
  it("doesn't claim a rename succeeded when orchestration rejects it", async () => {
    const test = harness({ mutationFails: true });
    await expect(
      test.run({ type: "thread.rename", threadId: "thread", title: "New" }),
    ).rejects.toThrow("Rename rejected");
    expect(test.thread.title).toBe("Original title");
  });
  it.each(["thread.details", "thread.rename"] as const)(
    "rejects %s for missing threads",
    async (type) => {
      const test = harness({ missing: true });
      await expect(test.run({ type, threadId: "missing", title: "New" })).rejects.toThrow(
        "Thread not found",
      );
      expect(test.dispatch).not.toHaveBeenCalled();
      expect(test.readBranchContext).not.toHaveBeenCalled();
    },
  );
  it.each([" ", "a".repeat(201)])("rejects invalid names at the wire boundary", (title) => {
    expect(
      GraftMobileCommandSchema.safeParse({ type: "thread.rename", threadId: "thread", title })
        .success,
    ).toBe(false);
  });
});
