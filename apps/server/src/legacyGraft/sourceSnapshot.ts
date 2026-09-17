import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import { syncDirectoryEntry } from "@graft/shared/filesystemPlatform";

import { digestFile, LEGACY_GRAFT_LIMITS, openRegularFile, protectArchiveFile } from "./files";

export type LegacyRow = Record<string, string | number | bigint | Uint8Array | null>;
export interface LegacySnapshot {
  sourceId: string;
  sourcePath: string;
  snapshotPath: string;
  sha256: string;
  schemaVersion: number;
  tables: Record<string, number>;
}

const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  schema_version: ["version"],
  projects: ["id", "name", "repoPath", "projectKind", "createdAt"],
  threads: [
    "id",
    "projectId",
    "title",
    "mode",
    "localPath",
    "providerHint",
    "modelName",
    "cliSessionId",
    "archivedAt",
    "createdAt",
    "updatedAt",
  ],
  worktrees: ["id", "projectId", "path", "branchName", "baseBranch", "status"],
  runs: ["id", "threadId", "kind", "createdAt"],
  events: ["id", "threadId", "runId", "type", "payload", "createdAt"],
  run_events: ["id", "threadId", "runId", "sequence", "payload"],
  message_parts: [
    "id",
    "threadId",
    "runId",
    "role",
    "partType",
    "partIndex",
    "content",
    "metadata",
    "createdAt",
    "updatedAt",
  ],
  attachments: ["id", "threadId", "filePath", "mimeType"],
};

export function sqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function columnsFor(database: DatabaseSync, table: string): Set<string> {
  return new Set(
    database
      .prepare(`PRAGMA table_info(${sqlIdentifier(table)})`)
      .all()
      .map((row) => String(row.name)),
  );
}

export function inspectLegacySnapshot(
  database: DatabaseSync,
): Pick<LegacySnapshot, "schemaVersion" | "tables"> {
  database.exec("PRAGMA trusted_schema = OFF");
  const integrity = database.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || Object.values(integrity[0] ?? {})[0] !== "ok") {
    throw new Error("Legacy database failed integrity verification.");
  }
  if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
    throw new Error("Legacy database has broken references; automatic import is unavailable.");
  }
  const definitions = database
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  if (
    definitions.some(
      (row) => typeof row.sql === "string" && /^CREATE\s+VIRTUAL\s+TABLE/i.test(row.sql),
    )
  ) {
    throw new Error("Virtual tables are unsupported in legacy migration.");
  }
  const names = new Set(definitions.map((row) => String(row.name)));
  if (names.size > 128)
    throw new Error("Legacy database has too many tables for automatic import.");
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    if (!names.has(table) || required.some((column) => !columnsFor(database, table).has(column))) {
      throw new Error(`Unrecognized legacy database capabilities: ${table}.`);
    }
  }
  const versions = database.prepare("SELECT version FROM schema_version").all();
  const version = versions[0]?.version;
  if (
    versions.length !== 1 ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1 ||
    version > 31
  ) {
    throw new Error("Unsupported legacy schema version; no data was imported.");
  }
  if (
    version >= 19 &&
    ["runs", "events", "message_parts", "attachments"].some(
      (table) => !columnsFor(database, table).has("threadSequence"),
    )
  ) {
    throw new Error("Legacy logical history sequence columns are missing.");
  }
  const tables: Record<string, number> = Object.create(null);
  let total = 0;
  for (const name of names) {
    const columns = [...columnsFor(database, name)];
    if (columns.length > 128)
      throw new Error("Legacy database has too many columns for automatic import.");
    const oversized = columns
      .map(
        (column) =>
          `length(CAST(${sqlIdentifier(column)} AS BLOB)) > ${LEGACY_GRAFT_LIMITS.cellBytes}`,
      )
      .join(" OR ");
    if (
      oversized &&
      database.prepare(`SELECT 1 FROM ${sqlIdentifier(name)} WHERE ${oversized} LIMIT 1`).get()
    )
      throw new Error("Legacy database contains a value above the automatic import byte limit.");
    const count = database
      .prepare(`SELECT count(*) AS count FROM ${sqlIdentifier(name)}`)
      .get()?.count;
    if (typeof count !== "number" || !Number.isSafeInteger(count))
      throw new Error("Invalid legacy row count.");
    tables[name] = count;
    total += count;
  }
  if (total > LEGACY_GRAFT_LIMITS.rows)
    throw new Error("Legacy database exceeds the automatic import row limit.");
  return { schemaVersion: version, tables };
}

/** Called only for an explicitly selected source; never runs legacy or new schema migrations. */
export async function createLegacySnapshot(
  sourceDbPath: string,
  directory: string,
): Promise<LegacySnapshot> {
  if (!path.isAbsolute(sourceDbPath)) throw new Error("Legacy source path must be absolute.");
  const sourceHandle = await openRegularFile(sourceDbPath, LEGACY_GRAFT_LIMITS.databaseBytes);
  await sourceHandle.close();
  const sourcePath = await fs.realpath(sourceDbPath);
  if (sourcePath === directory || sourcePath.startsWith(`${directory}${path.sep}`))
    throw new Error("Source database cannot be inside its migration archive.");
  const sourceId = createHash("sha256").update(sourcePath).digest("hex");
  const temporaryPath = path.join(directory, `source-${randomUUID()}.partial`);
  const snapshotPath = path.join(directory, "source.sqlite");
  const source = new DatabaseSync(sourcePath, { readOnly: true, allowExtension: false });
  try {
    const logical = source
      .prepare(
        "SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()",
      )
      .get()?.bytes;
    if (typeof logical !== "number" || logical > LEGACY_GRAFT_LIMITS.databaseBytes)
      throw new Error("Legacy database exceeds the snapshot size limit.");
    const disk = await fs.statfs(directory);
    if (Number(disk.bavail) * Number(disk.bsize) < logical * 2)
      throw new Error("Not enough disk space to preserve the legacy database.");
    const deadline = Date.now() + 120_000;
    await backup(source, temporaryPath, {
      rate: 256,
      progress: () => {
        if (Date.now() > deadline)
          throw new Error("Legacy snapshot timed out; close the old app and retry.");
      },
    });
  } catch (cause) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw cause;
  } finally {
    source.close();
  }
  try {
    const copy = new DatabaseSync(temporaryPath, { readOnly: true, allowExtension: false });
    let inspection: ReturnType<typeof inspectLegacySnapshot>;
    try {
      inspection = inspectLegacySnapshot(copy);
    } finally {
      copy.close();
    }
    const sha256 = await digestFile(temporaryPath);
    await protectArchiveFile(temporaryPath);
    // A completed source snapshot is immutable. Never replace one on retry.
    await fs.link(temporaryPath, snapshotPath);
    await syncDirectoryEntry(directory);
    return { sourceId, sourcePath, snapshotPath, sha256, ...inspection };
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
