import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, MessageId, OrchestrationCommand, ThreadId } from "@graft/contracts";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServerConfig } from "../config";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore";
import { makeSqlitePersistenceLive } from "../persistence/Layers/Sqlite";
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine";
import { OrchestrationProjectionPipelineLive } from "../orchestration/Layers/ProjectionPipeline";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { atomicJson, digestFile } from "./files";
import { createLegacyFixture } from "./fixtures";
import {
  getLegacyGraftImportProgress,
  prepareLegacyGraftImport,
  readLegacyGraftThreadArchive,
  runLegacyGraftImport,
} from "./importService";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function setupFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "graft-legacy-import-test-"));
  temporaryDirectories.push(directory);
  const source = path.join(directory, "source");
  await fs.mkdir(source);
  const fixture = createLegacyFixture(source);
  return { ...fixture, directory, source, destinationDir: path.join(directory, "archive") };
}

async function createSystem(dbPath: string) {
  const layer = OrchestrationEngineLive.pipe(
    Layer.provideMerge(OrchestrationProjectionPipelineLive),
    Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(OrchestrationCommandReceiptRepositoryLive),
    Layer.provideMerge(makeSqlitePersistenceLive(dbPath)),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "graft-legacy-engine-" })),
    Layer.provideMerge(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(layer);
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  const query = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
  return { runtime, engine, query, dispose: () => runtime.dispose() };
}

describe("legacy Graft import", () => {
  it("uses real SQLite backup to preserve committed WAL data and every source table without changing source bytes", async () => {
    const fixture = await setupFixture();
    try {
      const sourceMain = await digestFile(fixture.databasePath);
      const sourceWal = await digestFile(`${fixture.databasePath}-wal`);
      const progress = await prepareLegacyGraftImport({
        sourceDbPath: fixture.databasePath,
        destinationDir: fixture.destinationDir,
      });
      expect(await digestFile(fixture.databasePath)).toBe(sourceMain);
      expect(await digestFile(`${fixture.databasePath}-wal`)).toBe(sourceWal);
      expect(progress.summary).toMatchObject({
        sourceSchemaVersion: 31,
        importedProjects: 1,
        importedThreads: 1,
        importedMessages: 2,
        archiveOnlyThreads: 1,
        resumedThreads: 0,
        archivedAutomations: 1,
      });
      const frozen = new DatabaseSync(path.join(fixture.destinationDir, "source.sqlite"), {
        readOnly: true,
      });
      try {
        expect(frozen.prepare("SELECT value FROM preferences").get()?.value).toBe("preserve-me");
        expect(frozen.prepare("SELECT enabled FROM automations").get()?.enabled).toBe(1);
        expect(frozen.prepare("SELECT count(*) AS n FROM message_parts").get()?.n).toBe(4);
      } finally {
        frozen.close();
      }
      if (process.platform !== "win32")
        expect(
          (await fs.stat(path.join(fixture.destinationDir, "source.sqlite"))).mode & 0o777,
        ).toBe(0o400);
      const page = await readLegacyGraftThreadArchive(fixture.destinationDir, "thread", {
        limit: 200,
      });
      expect(
        page.records.some(
          (record) =>
            record.table === "run_events" &&
            String(record.row.payload).includes("must-not-execute"),
        ),
      ).toBe(true);
      expect(page.records.some((record) => record.table === "proposed_plans")).toBe(true);
      expect(
        page.records.some(
          (record) => record.row.content === "<script>touch /must-not-execute</script>",
        ),
      ).toBe(true);
      const first = await readLegacyGraftThreadArchive(fixture.destinationDir, "thread", {
        limit: 2,
      });
      expect(first.nextOffset).toBe(2);
      expect(
        (
          await readLegacyGraftThreadArchive(fixture.destinationDir, "thread", {
            offset: 2,
            limit: 2,
          })
        ).records,
      ).toEqual(page.records.slice(2, 4));
      await expect(
        readLegacyGraftThreadArchive(fixture.destinationDir, "../../source.sqlite"),
      ).rejects.toThrow("not found");
    } finally {
      fixture.database.close();
    }
  });

  it("restarts actual orchestration after a committed command loses its checkpoint, without duplication or provider startup", async () => {
    const fixture = await setupFixture();
    const statePath = path.join(fixture.directory, "new-state.sqlite");
    let system = await createSystem(statePath);
    try {
      const prepared = await prepareLegacyGraftImport({
        sourceDbPath: fixture.databasePath,
        destinationDir: fixture.destinationDir,
      });
      const blocked = new Set<ThreadId>();
      const registerBlockedThreads = vi.fn(async (ids: readonly ThreadId[]) => {
        for (const id of ids) blocked.add(id);
      });
      let committed = 0;
      await expect(
        runLegacyGraftImport({
          destinationDir: fixture.destinationDir,
          registerBlockedThreads,
          dispatch: async (command) => {
            if ("threadId" in command) expect(blocked.has(command.threadId)).toBe(true);
            const result = await system.runtime.runPromise(system.engine.dispatch(command));
            if (++committed === 3) throw new Error("Simulated crash after event commit");
            return result;
          },
        }),
      ).rejects.toThrow("Simulated crash");
      expect((await getLegacyGraftImportProgress(fixture.destinationDir)).completedCommands).toBe(
        2,
      );
      await system.dispose();
      system = await createSystem(statePath);
      const result = await runLegacyGraftImport({
        destinationDir: fixture.destinationDir,
        registerBlockedThreads,
        dispatch: (command) => system.runtime.runPromise(system.engine.dispatch(command)),
      });
      expect(result.phase).toBe("complete");
      const threadId = prepared.summary.threads[0]?.importedThreadId;
      if (!threadId) throw new Error("Fixture imported thread missing");
      const detail = Option.getOrNull(
        await system.runtime.runPromise(system.query.getThreadDetailById(threadId)),
      );
      expect(detail?.messages.map((message) => message.text)).toEqual([
        "Original prompt",
        "Original response",
      ]);
      expect(detail?.session).toBeNull();
      expect(detail?.worktreePath).toBe("/tmp/legacy-worktree");
      expect(detail?.activities[0]?.payload).toMatchObject({
        sourceSessionId: "native-session-1",
        sourceProviderInstanceId: "instance-1",
        resumeStatus: "reconnect-required",
      });
      await expect(
        system.runtime.runPromise(
          system.engine.dispatch({
            type: "thread.turn.start",
            commandId: CommandId.makeUnsafe("rejected-legacy-turn"),
            threadId,
            message: {
              messageId: MessageId.makeUnsafe("rejected-legacy-message"),
              role: "user",
              text: "Do not run",
              attachments: [],
            },
            runtimeMode: "approval-required",
            interactionMode: "default",
            createdAt: new Date().toISOString(),
          }),
        ),
      ).rejects.toThrow("read-only");
      if (!detail) throw new Error("Imported thread detail missing");
      await expect(
        system.runtime.runPromise(
          system.engine.dispatch({
            type: "thread.fork.create",
            commandId: CommandId.makeUnsafe("rejected-legacy-fork"),
            threadId: ThreadId.makeUnsafe("new-fork"),
            sourceThreadId: threadId,
            sidechatSourceThreadId: threadId,
            projectId: detail.projectId,
            title: "Do not fork",
            modelSelection: detail.modelSelection,
            runtimeMode: "approval-required",
            interactionMode: "default",
            envMode: "local",
            branch: null,
            worktreePath: null,
            importedMessages: [],
            createdAt: new Date().toISOString(),
          }),
        ),
      ).rejects.toThrow("read-only");
      const noDispatch = vi.fn(async (_command: OrchestrationCommand) => undefined);
      await runLegacyGraftImport({
        destinationDir: fixture.destinationDir,
        registerBlockedThreads,
        dispatch: noDispatch,
      });
      expect(noDispatch).not.toHaveBeenCalled();
      await system.dispose();
      const sql = new DatabaseSync(statePath, { readOnly: true });
      try {
        expect(
          sql.prepare("SELECT count(*) AS count FROM provider_session_runtime").get()?.count,
        ).toBe(0);
        expect(
          sql.prepare("SELECT count(*) AS count FROM automation_definitions").get()?.count,
        ).toBe(0);
      } finally {
        sql.close();
      }
    } finally {
      fixture.database.close();
      await system.dispose();
    }
  });

  it("refuses unsupported schemas, broken capabilities, and incomplete admission before dispatch", async () => {
    const fixture = await setupFixture();
    try {
      fixture.database.exec("UPDATE schema_version SET version = 32");
      await expect(
        prepareLegacyGraftImport({
          sourceDbPath: fixture.databasePath,
          destinationDir: fixture.destinationDir,
        }),
      ).rejects.toThrow("Unsupported legacy schema");
      fixture.database.exec(
        "UPDATE schema_version SET version = 31; ALTER TABLE message_parts RENAME COLUMN threadSequence TO unknownSequence",
      );
      await expect(
        prepareLegacyGraftImport({
          sourceDbPath: fixture.databasePath,
          destinationDir: fixture.destinationDir,
        }),
      ).rejects.toThrow("sequence columns");
      fixture.database.exec(
        "ALTER TABLE message_parts RENAME COLUMN unknownSequence TO threadSequence",
      );
      await prepareLegacyGraftImport({
        sourceDbPath: fixture.databasePath,
        destinationDir: fixture.destinationDir,
      });
      const dispatch = vi.fn(async (_command: OrchestrationCommand) => undefined);
      await expect(
        runLegacyGraftImport({
          destinationDir: fixture.destinationDir,
          dispatch,
          registerBlockedThreads: async () => {
            throw new Error("Admission persistence failed");
          },
        }),
      ).rejects.toThrow("Admission persistence failed");
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      fixture.database.close();
    }
  });

  it("copies approved attachment bytes, reports missing/external/symlink paths, and never follows imported traversal", async () => {
    const fixture = await setupFixture();
    try {
      const attachment = path.join(fixture.source, "image.png");
      const external = path.join(fixture.directory, "secret.txt");
      const missing = path.join(fixture.source, "missing.png");
      await fs.writeFile(attachment, "original attachment");
      await fs.writeFile(external, "do not copy");
      const unsafe = path.join(fixture.source, "unsafe.png");
      if (process.platform !== "win32") await fs.symlink(external, unsafe);
      for (const [id, filePath] of [
        ["good", attachment],
        ["external", external],
        ["missing", missing],
        ...(process.platform !== "win32" ? [["unsafe", unsafe]] : []),
      ])
        fixture.database
          .prepare("INSERT INTO attachments VALUES (?, 'thread', ?, 'image/png', 1)")
          .run(id!, filePath!);
      const result = await prepareLegacyGraftImport({
        sourceDbPath: fixture.databasePath,
        destinationDir: fixture.destinationDir,
      });
      expect(
        result.summary.attachments.find((entry) => entry.sourcePath === external)?.disposition,
      ).toBe("outside-approved-roots");
      expect(
        result.summary.attachments.find((entry) => entry.sourcePath === missing)?.disposition,
      ).toBe("missing");
      if (process.platform !== "win32")
        expect(
          result.summary.attachments.find((entry) => entry.sourcePath === unsafe)?.disposition,
        ).toBe("unsafe");
      const copied = result.summary.attachments.find((entry) => entry.sourcePath === attachment);
      expect(copied?.disposition).toBe("copied");
      expect(
        await fs.readFile(path.join(fixture.destinationDir, copied!.archiveFile!), "utf8"),
      ).toBe("original attachment");
    } finally {
      fixture.database.close();
    }
  });

  it("freezes identity across source changes and detects plan/archive/checkpoint tampering", async () => {
    const fixture = await setupFixture();
    try {
      const first = await prepareLegacyGraftImport({
        sourceDbPath: fixture.databasePath,
        destinationDir: fixture.destinationDir,
      });
      fixture.database.exec("UPDATE threads SET title = 'Changed later'");
      expect(
        (
          await prepareLegacyGraftImport({
            sourceDbPath: fixture.databasePath,
            destinationDir: fixture.destinationDir,
          })
        ).summary,
      ).toEqual(first.summary);
      const planPath = path.join(fixture.destinationDir, "plan.json");
      const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
      for (const command of plan.commands)
        expect(Schema.is(OrchestrationCommand)(command)).toBe(true);
      await atomicJson(path.join(fixture.destinationDir, "checkpoint.json"), {
        version: 1,
        planSha256: "wrong",
        completedCommands: 1,
      });
      await expect(getLegacyGraftImportProgress(fixture.destinationDir)).rejects.toThrow(
        "checkpoint",
      );
      await fs.rm(path.join(fixture.destinationDir, "checkpoint.json"));
      plan.commands[0].createWorkspaceRootIfMissing = true;
      await atomicJson(planPath, plan);
      await expect(getLegacyGraftImportProgress(fixture.destinationDir)).rejects.toThrow(
        "cannot create workspace",
      );
    } finally {
      fixture.database.close();
    }
  });

  it("recovers an interrupted preparation from the published snapshot and removes only abandoned snapshot partials", async () => {
    const fixture = await setupFixture();
    try {
      const first = await prepareLegacyGraftImport({
        sourceDbPath: fixture.databasePath,
        destinationDir: fixture.destinationDir,
      });
      const digest = await digestFile(path.join(fixture.destinationDir, "source.sqlite"));
      await fs.rm(path.join(fixture.destinationDir, "plan.json"));
      await fs.rm(path.join(fixture.destinationDir, "snapshot.json"));
      const partial = path.join(
        fixture.destinationDir,
        "source-00000000-0000-4000-8000-000000000000.partial",
      );
      await fs.writeFile(partial, "interrupted unpublished backup");
      fixture.database.exec("UPDATE threads SET title = 'Later source changes'");
      const resumed = await prepareLegacyGraftImport({
        sourceDbPath: fixture.databasePath,
        destinationDir: fixture.destinationDir,
      });
      expect(resumed.summary.threads).toEqual(first.summary.threads);
      expect(await digestFile(path.join(fixture.destinationDir, "source.sqlite"))).toBe(digest);
      await expect(fs.lstat(partial)).rejects.toThrow();
      expect((await fs.readdir(fixture.source)).includes("graft-local.db")).toBe(true);
    } finally {
      fixture.database.close();
    }
  });

  it("rejects oversized source values before creating commands and refuses symlink archive files", async () => {
    const fixture = await setupFixture();
    try {
      fixture.database
        .prepare("UPDATE preferences SET value = ?")
        .run("x".repeat(4 * 1024 ** 2 + 1));
      await expect(
        prepareLegacyGraftImport({
          sourceDbPath: fixture.databasePath,
          destinationDir: fixture.destinationDir,
        }),
      ).rejects.toThrow("byte limit");
      await expect(fs.lstat(path.join(fixture.destinationDir, "plan.json"))).rejects.toThrow();
      fixture.database.exec("UPDATE preferences SET value = 'small'");
      const result = await prepareLegacyGraftImport({
        sourceDbPath: fixture.databasePath,
        destinationDir: fixture.destinationDir,
      });
      if (process.platform !== "win32") {
        const archive = result.summary.threads.find(
          (thread) => thread.sourceThreadId === "thread",
        )!;
        const archivePath = path.join(fixture.destinationDir, archive.archiveFile);
        await fs.rm(archivePath);
        await fs.symlink(fixture.databasePath, archivePath);
        await expect(
          readLegacyGraftThreadArchive(fixture.destinationDir, "thread"),
        ).rejects.toThrow("regular file");
      }
    } finally {
      fixture.database.close();
    }
  });
});
