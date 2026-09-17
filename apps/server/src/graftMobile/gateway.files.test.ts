import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import type { GraftMobileCommand } from "@graft/mobile-contract";
import { ProjectId, ThreadId } from "@graft/contracts";
import { Effect, Layer, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ServerConfig } from "../config";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment";
import { GitCore } from "../git/Services/GitCore";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { ProviderDiscoveryService } from "../provider/Services/ProviderDiscoveryService";
import { ServerSettingsService } from "../serverSettings";
import { WorkspaceEntriesLive } from "../workspace/Layers/WorkspaceEntries";
import { WorkspaceFileSystemLive } from "../workspace/Layers/WorkspaceFileSystem";
import { WorkspacePathsLive } from "../workspace/Layers/WorkspacePaths";
import { executeMobileCommand, makeGraftMobileGatewayState } from "./gateway";

let root: string;
let cwd: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "graft-mobile-files-"));
  cwd = join(root, "worktree");
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(join(cwd, "src", "Chat.tsx"), "export const Chat = () => <main>Hello</main>;\n");
  await writeFile(join(root, "outside.md"), "outside workspace");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function run(command: GraftMobileCommand) {
  const thread = {
    id: ThreadId.makeUnsafe("thread"),
    projectId: ProjectId.makeUnsafe("project"),
    envMode: "worktree",
    worktreePath: cwd,
    workingDirectory: null,
  };
  const workspace = Layer.mergeAll(
    WorkspaceEntriesLive,
    WorkspaceFileSystemLive.pipe(
      Layer.provide(WorkspacePathsLive),
      Layer.provide(WorkspaceEntriesLive),
    ),
  ).pipe(Layer.provide(NodeServices.layer));
  const services = Layer.mergeAll(
    workspace,
    Layer.succeed(OrchestrationEngineService, {} as never),
    Layer.succeed(ProjectionSnapshotQuery, {
      getThreadShellById: () => Effect.succeed(Option.some(thread)),
      getProjectShellById: () =>
        Effect.succeed(
          Option.some({ id: thread.projectId, kind: "repository", workspaceRoot: root }),
        ),
    } as never),
    Layer.succeed(ProviderDiscoveryService, {} as never),
    Layer.succeed(ServerConfig, {} as never),
    Layer.succeed(ServerEnvironment, {} as never),
    Layer.succeed(ServerSettingsService, {} as never),
    Layer.succeed(GitCore, {} as never),
  );
  return Effect.runPromise(
    executeMobileCommand(makeGraftMobileGatewayState(), "command", command).pipe(
      Effect.provide(services),
    ),
  );
}

describe("mobile workspace file references", () => {
  it("resolves partial and absolute references against the thread's worktree", async () => {
    expect(
      await run({
        type: "files.resolve",
        threadId: "thread",
        references: ["Chat.tsx", join(cwd, "src/Chat.tsx"), "missing.md", join(root, "outside.md")],
      }),
    ).toEqual({
      type: "files.resolve.result",
      references: [
        { reference: "Chat.tsx", path: "src/Chat.tsx" },
        { reference: join(cwd, "src/Chat.tsx"), path: "src/Chat.tsx" },
        { reference: "missing.md", path: null },
        { reference: join(root, "outside.md"), path: null },
      ],
    });
  });
  it("reads the real file through the shared desktop file service", async () => {
    expect(await run({ type: "file.read", threadId: "thread", path: "src/Chat.tsx" })).toEqual({
      type: "file.read.result",
      file: {
        path: "src/Chat.tsx",
        contents: "export const Chat = () => <main>Hello</main>;\n",
        truncated: false,
      },
    });
  });
  it("keeps ambiguous basenames unresolved", async () => {
    await mkdir(join(cwd, "other"));
    await writeFile(join(cwd, "src/index.ts"), "first");
    await writeFile(join(cwd, "other/index.ts"), "second");
    expect(
      await run({ type: "files.resolve", threadId: "thread", references: ["index.ts"] }),
    ).toMatchObject({ references: [{ reference: "index.ts", path: null }] });
  });
  it("rejects traversal, outside absolute paths, and symlinks escaping the worktree", async () => {
    await symlink(join(root, "outside.md"), join(cwd, "alias.md"));
    for (const path of ["../outside.md", join(root, "outside.md"), "alias.md"]) {
      await expect(run({ type: "file.read", threadId: "thread", path })).rejects.toBeDefined();
    }
  });
  it("bounds large file previews without losing the truncation signal", async () => {
    await writeFile(join(cwd, "large.txt"), "a".repeat(90_000));
    const result = await run({ type: "file.read", threadId: "thread", path: "large.txt" });
    expect(result.type).toBe("file.read.result");
    if (result.type !== "file.read.result") throw new Error("Unexpected result");
    expect(result.file.truncated).toBe(true);
    expect(result.file.contents.length).toBeLessThanOrEqual(80_000);
  });
});
