import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  LegacyGraftImportSummary,
  OrchestrationCommand,
  ThreadId,
  type LegacyGraftImportProgress,
} from "@graft/contracts";
import { Effect, Schema } from "effect";

import { withDatabaseLifecycleLock } from "../persistence/DatabaseLifecycleLock";
import { archiveLegacyAttachments, exportLegacyThreads } from "./archive";
import {
  atomicJson,
  digestFile,
  LEGACY_GRAFT_LIMITS,
  openRegularFile,
  privateDirectory,
  readJson,
  safeArchivePath,
} from "./files";
import { mapLegacySnapshot, type LegacyGraftPlan } from "./mapSnapshot";
import { createLegacySnapshot, inspectLegacySnapshot, type LegacySnapshot } from "./sourceSnapshot";

const StoredPlan = Schema.Struct({
  version: Schema.Literal(1),
  snapshotSha256: Schema.String,
  summary: LegacyGraftImportSummary,
  commands: Schema.Array(OrchestrationCommand),
  blockedThreadIds: Schema.Array(ThreadId),
});
const SnapshotMetadata = Schema.Struct({
  sourceId: Schema.String,
  sourcePath: Schema.String,
  snapshotPath: Schema.String,
  sha256: Schema.String,
  schemaVersion: Schema.Number,
  tables: Schema.Record(Schema.String, Schema.Number),
});
const Checkpoint = Schema.Struct({
  version: Schema.Literal(1),
  planSha256: Schema.String,
  completedCommands: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
const SourceIdentity = Schema.Struct({
  version: Schema.Literal(1),
  sourcePath: Schema.String,
  sourceId: Schema.String,
});

async function optionalJson(filePath: string): Promise<unknown | null> {
  try {
    return await readJson(filePath);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

async function withImportLock<A>(
  directory: string,
  operation: (canonicalDirectory: string) => Promise<A>,
): Promise<A> {
  const canonicalDirectory = await privateDirectory(directory);
  return Effect.runPromise(
    withDatabaseLifecycleLock(
      path.join(canonicalDirectory, "import-state"),
      Effect.tryPromise({ try: () => operation(canonicalDirectory), catch: (cause) => cause }),
    ),
  );
}

async function removeAbandonedSnapshots(directory: string): Promise<void> {
  // The destination lifecycle lock proves no other import owns these partials.
  // Published source.sqlite and all legacy profile files are excluded.
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && /^source-[a-f0-9-]{36}\.partial$/.test(entry.name)) {
      await fs.rm(path.join(directory, entry.name));
    }
  }
}

function checkPlanCommands(plan: typeof StoredPlan.Type): void {
  const allowed = new Set([
    "project.create",
    "thread.create",
    "thread.messages.import",
    "thread.activity.append",
    "thread.archive",
  ]);
  const blocked = new Set(plan.blockedThreadIds);
  const seen = new Set<string>();
  for (const command of plan.commands) {
    if (
      !allowed.has(command.type) ||
      !command.commandId.startsWith("legacy-graft:command-") ||
      seen.has(command.commandId)
    )
      throw new Error("Legacy plan contains an invalid offline command.");
    seen.add(command.commandId);
    if (command.type === "project.create" && command.createWorkspaceRootIfMissing)
      throw new Error("Legacy import cannot create workspace folders.");
    if (
      command.type === "thread.create" &&
      (!blocked.has(command.threadId) || command.runtimeMode !== "approval-required")
    )
      throw new Error("Legacy imported threads must be blocked before creation.");
    if ("threadId" in command && !blocked.has(command.threadId))
      throw new Error("Legacy command targets a thread outside its import.");
  }
}

async function loadPlan(directory: string) {
  const planPath = path.join(directory, "plan.json");
  const plan = Schema.decodeUnknownSync(StoredPlan)(await readJson(planPath));
  checkPlanCommands(plan);
  return { plan, planSha256: await digestFile(planPath) };
}

async function checkpointFor(directory: string, planSha256: string, totalCommands: number) {
  const value = await optionalJson(path.join(directory, "checkpoint.json"));
  const checkpoint =
    value === null
      ? { version: 1 as const, planSha256, completedCommands: 0 }
      : Schema.decodeUnknownSync(Checkpoint)(value);
  if (checkpoint.planSha256 !== planSha256 || checkpoint.completedCommands > totalCommands)
    throw new Error("Legacy import checkpoint does not match its frozen plan.");
  return checkpoint;
}

export interface PrepareLegacyGraftImportOptions {
  readonly sourceDbPath: string;
  readonly destinationDir: string;
  /** Defaults to the source profile directory. Other paths remain explicit references. */
  readonly allowedAttachmentRoots?: readonly string[];
}

export async function prepareLegacyGraftImport(
  options: PrepareLegacyGraftImportOptions,
): Promise<LegacyGraftImportProgress> {
  return withImportLock(options.destinationDir, async (directory) => {
    await removeAbandonedSnapshots(directory);
    const identityPath = path.join(directory, "source.json");
    const savedIdentity = await optionalJson(identityPath);
    const requestedPath = path.resolve(options.sourceDbPath);
    if (!path.isAbsolute(options.sourceDbPath))
      throw new Error("Legacy source path must be absolute.");
    // Once frozen, a retry can use the archive even if the old installation was moved.
    const sourcePath = savedIdentity === null ? await fs.realpath(requestedPath) : null;
    const identity =
      sourcePath !== null
        ? {
            version: 1 as const,
            sourcePath,
            sourceId: createHash("sha256").update(sourcePath).digest("hex"),
          }
        : Schema.decodeUnknownSync(SourceIdentity)(savedIdentity);
    if (savedIdentity !== null && identity.sourcePath !== requestedPath) {
      const actual = await fs.realpath(requestedPath).catch(() => requestedPath);
      if (identity.sourcePath !== actual)
        throw new Error("This migration archive belongs to another legacy profile.");
    }
    if (savedIdentity === null) {
      await atomicJson(identityPath, identity);
    }
    if (await optionalJson(path.join(directory, "plan.json")))
      return getLegacyGraftImportProgress(directory);
    const metadataPath = path.join(directory, "snapshot.json");
    const metadata = await optionalJson(metadataPath);
    let snapshot: LegacySnapshot;
    if (metadata !== null) {
      snapshot = Schema.decodeUnknownSync(SnapshotMetadata)(metadata);
    } else {
      const frozenPath = path.join(directory, "source.sqlite");
      if (
        await fs.lstat(frozenPath).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        )
      ) {
        // Recover a crash after publishing the snapshot but before its metadata write.
        const sha256 = await digestFile(frozenPath);
        const copy = new DatabaseSync(frozenPath, { readOnly: true, allowExtension: false });
        try {
          snapshot = {
            ...inspectLegacySnapshot(copy),
            sourceId: identity.sourceId,
            sourcePath: identity.sourcePath,
            snapshotPath: frozenPath,
            sha256,
          };
        } finally {
          copy.close();
        }
      } else {
        snapshot = await createLegacySnapshot(identity.sourcePath, directory);
      }
      await atomicJson(metadataPath, snapshot);
    }
    if (
      snapshot.sourceId !== identity.sourceId ||
      snapshot.sourcePath !== identity.sourcePath ||
      snapshot.snapshotPath !== path.join(directory, "source.sqlite") ||
      (await digestFile(snapshot.snapshotPath)) !== snapshot.sha256
    )
      throw new Error("Legacy snapshot identity or integrity changed.");
    const copy = new DatabaseSync(snapshot.snapshotPath, {
      readOnly: true,
      allowExtension: false,
    });
    try {
      const mapped: LegacyGraftPlan = mapLegacySnapshot(copy, snapshot, new Date().toISOString());
      await exportLegacyThreads(copy, directory, Object.keys(snapshot.tables));
      const attachments = await archiveLegacyAttachments(
        copy,
        directory,
        options.allowedAttachmentRoots ?? [path.dirname(identity.sourcePath)],
      );
      const plan = { ...mapped, summary: { ...mapped.summary, attachments } };
      await atomicJson(path.join(directory, "plan.json"), plan);
    } finally {
      copy.close();
    }
    return getLegacyGraftImportProgress(directory);
  });
}

export interface RunLegacyGraftImportOptions {
  readonly destinationDir: string;
  readonly dispatch: (command: OrchestrationCommand) => Promise<unknown>;
  /** Must durably enforce read-only imported threads before the first thread is visible. */
  readonly registerBlockedThreads: (threadIds: readonly ThreadId[]) => Promise<void>;
}

export async function runLegacyGraftImport(
  options: RunLegacyGraftImportOptions,
): Promise<LegacyGraftImportProgress> {
  return withImportLock(options.destinationDir, async (directory) => {
    const { plan, planSha256 } = await loadPlan(directory);
    if ((await digestFile(path.join(directory, "source.sqlite"))) !== plan.snapshotSha256)
      throw new Error("Legacy source archive changed after preparation.");
    const checkpoint = await checkpointFor(directory, planSha256, plan.commands.length);
    await options.registerBlockedThreads(plan.blockedThreadIds);
    for (let index = checkpoint.completedCommands; index < plan.commands.length; index += 1) {
      const command = plan.commands[index];
      if (!command) throw new Error("Missing legacy import command.");
      await options.dispatch(command);
      // A crash between commit and this write replays the SAME command ID. The
      // orchestration engine's durable receipt then returns its original result.
      await atomicJson(path.join(directory, "checkpoint.json"), {
        version: 1,
        planSha256,
        completedCommands: index + 1,
      });
    }
    return getLegacyGraftImportProgress(directory);
  });
}

export async function getLegacyGraftImportProgress(
  destinationDir: string,
): Promise<LegacyGraftImportProgress> {
  const { plan, planSha256 } = await loadPlan(destinationDir);
  const checkpoint = await checkpointFor(destinationDir, planSha256, plan.commands.length);
  return {
    phase:
      checkpoint.completedCommands === plan.commands.length
        ? "complete"
        : checkpoint.completedCommands === 0
          ? "prepared"
          : "importing",
    completedCommands: checkpoint.completedCommands,
    totalCommands: plan.commands.length,
    summary: plan.summary,
  };
}

export interface LegacyGraftArchivePage {
  readonly records: readonly { table: string; row: Record<string, unknown> }[];
  readonly nextOffset: number | null;
}

/** Reads only a manifest-listed inert JSONL export; caller enforces owner authentication. */
export async function readLegacyGraftThreadArchive(
  destinationDir: string,
  sourceThreadId: string,
  options: { offset?: number; limit?: number } = {},
): Promise<LegacyGraftArchivePage> {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 100;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throw new Error("Invalid archive page.");
  const { plan } = await loadPlan(destinationDir);
  const thread = plan.summary.threads.find(
    (candidate) => candidate.sourceThreadId === sourceThreadId,
  );
  if (!thread) throw new Error("Legacy thread archive was not found.");
  const target = safeArchivePath(destinationDir, thread.archiveFile);
  const directoryStat = await fs.lstat(path.dirname(target));
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
    throw new Error("Unsafe legacy archive directory.");
  // Each line has a bounded size and is JSON only. Stream to avoid allocating an
  // entire large transcript for a paged owner request.
  const handle = await openRegularFile(target, LEGACY_GRAFT_LIMITS.exportBytes);
  const records: { table: string; row: Record<string, unknown> }[] = [];
  let index = 0;
  let more = false;
  let pageBytes = 0;
  try {
    for await (const line of handle.readLines()) {
      if (index++ < offset) continue;
      if (records.length === limit) {
        more = true;
        break;
      }
      const lineBytes = Buffer.byteLength(line);
      if (lineBytes > LEGACY_GRAFT_LIMITS.cellBytes)
        throw new Error("Legacy archive line exceeds its limit.");
      if (records.length > 0 && pageBytes + lineBytes > LEGACY_GRAFT_LIMITS.cellBytes) {
        more = true;
        break;
      }
      pageBytes += lineBytes;
      const value: unknown = JSON.parse(line);
      if (
        !value ||
        typeof value !== "object" ||
        !("table" in value) ||
        typeof value.table !== "string" ||
        !("row" in value) ||
        !value.row ||
        typeof value.row !== "object" ||
        Array.isArray(value.row)
      )
        throw new Error("Invalid legacy archive record.");
      records.push({ table: value.table, row: value.row as Record<string, unknown> });
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  return { records, nextOffset: more ? offset + records.length : null };
}
