import type { GraftMobileCommand } from "@graft/mobile-contract";
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

function harness() {
  const thread = {
    id: ThreadId.makeUnsafe("thread"),
    projectId: ProjectId.makeUnsafe("project"),
    modelSelection: { provider: "codex", model: "gpt-5.5" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    envMode: "worktree",
    worktreePath: "/workspace/worktree",
    workingDirectory: null,
    latestTurn: { turnId: "previous-turn", state: "completed" },
  };
  const skill = {
    name: "swiftui-specialist",
    path: "/workspace/skills/swiftui-specialist/SKILL.md",
    enabled: true,
  };
  const listCommands = vi.fn(() => Effect.succeed({ commands: [] }));
  const listSkills = vi.fn(() => Effect.succeed({ skills: [skill] }));
  const readFile = vi.fn(() =>
    Effect.succeed({
      relativePath: "SKILL.md",
      contents: "# SwiftUI\n\nUse native SwiftUI views.",
      truncated: false,
    }),
  );
  const dispatch = vi.fn(() => Effect.fail(new Error("dispatch reached")));
  const status = vi.fn(() =>
    Effect.succeed({
      hasWorkingTreeChanges: true,
      workingTree: {
        files: [{ path: "changed.swift", insertions: 2, deletions: 1 }],
        insertions: 2,
        deletions: 1,
      },
    }),
  );
  const readWorkingTreePatch = vi.fn(() =>
    Effect.succeed({
      patch:
        "diff --git a/changed.swift b/changed.swift\n--- a/changed.swift\n+++ b/changed.swift\n@@ -1 +1,2 @@\n-before\n+after\n+more\n",
      truncated: false,
    }),
  );
  const services = Layer.mergeAll(
    Layer.succeed(OrchestrationEngineService, { dispatch } as never),
    Layer.succeed(ProjectionSnapshotQuery, {
      getThreadShellById: () => Effect.succeed(Option.some(thread)),
      getProjectShellById: () =>
        Effect.succeed(
          Option.some({
            id: thread.projectId,
            kind: "repository",
            workspaceRoot: "/workspace/repo",
          }),
        ),
    } as never),
    Layer.succeed(ProviderDiscoveryService, { listCommands, listSkills } as never),
    Layer.succeed(ServerConfig, {} as never),
    Layer.succeed(WorkspaceEntries, {} as never),
    Layer.succeed(WorkspaceFileSystem, { readFile } as never),
    Layer.succeed(ServerEnvironment, {} as never),
    Layer.succeed(ServerSettingsService, {
      getSettings: Effect.succeed({ providers: { codex: { binaryPath: "" } } }),
    } as never),
    Layer.succeed(GitCore, {
      status,
      readWorkingTreePatch,
      execute: () => Effect.succeed({ stdout: " M changed.swift\0", stderr: "", code: 0 }),
    } as never),
  );
  const run = (command: GraftMobileCommand) =>
    Effect.runPromise(
      executeMobileCommand(makeGraftMobileGatewayState(), "command", command).pipe(
        Effect.provide(services),
      ),
    );
  return {
    run,
    thread,
    skill,
    listCommands,
    listSkills,
    readFile,
    dispatch,
    status,
    readWorkingTreePatch,
  };
}

describe("mobile composer gateway", () => {
  it("previews only the selected provider's discovered skill file with a bounded read", async () => {
    const test = harness();
    const result = await test.run({
      type: "composer.skill.read",
      threadId: "thread",
      name: test.skill.name,
    });
    expect(test.readFile).toHaveBeenCalledWith({
      cwd: "/workspace/skills/swiftui-specialist",
      relativePath: "SKILL.md",
      maxBytes: 80_000,
    });
    expect(result).toMatchObject({
      type: "composer.skill.read.result",
      skill: {
        name: test.skill.name,
        contents: "# SwiftUI\n\nUse native SwiftUI views.",
        truncated: false,
      },
    });
    expect(test.dispatch).not.toHaveBeenCalled();
  });
  it("does not read unknown paths or a skill that was disabled after discovery", async () => {
    const test = harness();
    await expect(
      test.run({ type: "composer.skill.read", threadId: "thread", name: "/private/secret" }),
    ).rejects.toThrow("no longer available");
    test.skill.enabled = false;
    await expect(
      test.run({ type: "composer.skill.read", threadId: "thread", name: test.skill.name }),
    ).rejects.toThrow("no longer available");
    expect(test.readFile).not.toHaveBeenCalled();
  });
  it("reports truncated skill previews without changing invocation behavior", async () => {
    const test = harness();
    test.readFile.mockReturnValue(
      Effect.succeed({ relativePath: "SKILL.md", contents: "# Partial", truncated: true }),
    );
    expect(
      await test.run({ type: "composer.skill.read", threadId: "thread", name: test.skill.name }),
    ).toMatchObject({
      skill: { contents: "# Partial", truncated: true },
    });
  });
  it("does not offer task tracking in Codex Plan mode, which disallows update_plan", async () => {
    const test = harness();
    test.thread.interactionMode = "plan";
    const result = await test.run({ type: "composer.commands", threadId: "thread" });
    expect(result).toMatchObject({
      commands: expect.not.arrayContaining([expect.objectContaining({ kind: "tasks" })]),
    });
  });
  it("discovers skills only for the selected provider in the thread worktree", async () => {
    const test = harness();
    const result = await test.run({ type: "composer.commands", threadId: "thread" });
    expect(test.listSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codex",
        cwd: "/workspace/worktree",
        threadId: "thread",
      }),
    );
    expect(test.listCommands).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      type: "composer.commands.result",
      commands: expect.arrayContaining([
        expect.objectContaining({ name: "swiftui-specialist", kind: "skill" }),
      ]),
    });
  });
  it("dispatches the server-discovered skill and preserves the user's visible message", async () => {
    const test = harness();
    await expect(
      test.run({ type: "turn.start", threadId: "thread", text: "/swiftui-specialist fix chat" }),
    ).rejects.toThrow("dispatch reached");
    expect(test.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          text: "/swiftui-specialist fix chat",
          skills: [{ name: test.skill.name, path: test.skill.path }],
        }),
      }),
      undefined,
    );
  });
  it("keeps working changes after a later turn and clears them when the tree is clean", async () => {
    const test = harness();
    const first = await test.run({ type: "diff.get", diffId: "thread" });
    test.thread.latestTurn.turnId = "later-turn-with-no-edits";
    const later = await test.run({ type: "diff.get", diffId: "thread" });
    expect(first).toMatchObject({
      diff: { files: [{ path: "changed.swift", additions: 2, deletions: 1 }] },
    });
    expect(later).toMatchObject({
      diff: { files: [{ path: "changed.swift", additions: 2, deletions: 1 }] },
    });
    expect(test.status).toHaveBeenLastCalledWith({ cwd: "/workspace/worktree" });
    test.status.mockReturnValue(
      Effect.succeed({
        hasWorkingTreeChanges: false,
        workingTree: { files: [], insertions: 0, deletions: 0 },
      }),
    );
    expect(await test.run({ type: "diff.get", diffId: "thread" })).toMatchObject({
      diff: { files: [] },
    });
  });
  it("opens the current working file patch and never reads a path absent from the summary", async () => {
    const test = harness();
    const result = await test.run({
      type: "diff.get",
      diffId: "thread",
      filePath: "changed.swift",
    });
    expect(test.readWorkingTreePatch).toHaveBeenCalledWith("/workspace/worktree", "changed.swift");
    expect(result).toMatchObject({
      diff: {
        files: [
          {
            path: "changed.swift",
            detailStatus: "ready",
            hunks: [
              {
                lines: expect.arrayContaining([
                  expect.objectContaining({ kind: "deletion", text: "before" }),
                  expect.objectContaining({ kind: "addition", text: "after" }),
                ]),
              },
            ],
          },
        ],
      },
    });
    test.readWorkingTreePatch.mockClear();
    await test.run({ type: "diff.get", diffId: "thread", filePath: "../../private/secret" });
    expect(test.readWorkingTreePatch).not.toHaveBeenCalled();
  });
  it("marks a bounded working patch as truncated", async () => {
    const test = harness();
    const original = test.readWorkingTreePatch();
    test.readWorkingTreePatch.mockReturnValue(
      original.pipe(Effect.map((patch) => ({ ...patch, truncated: true }))),
    );
    expect(
      await test.run({ type: "diff.get", diffId: "thread", filePath: "changed.swift" }),
    ).toMatchObject({
      diff: { files: [{ detailStatus: "truncated" }] },
    });
  });
});
