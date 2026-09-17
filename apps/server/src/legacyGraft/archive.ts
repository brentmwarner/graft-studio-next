import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import type { LegacyGraftAttachmentSummary } from "@graft/contracts";

import {
  LEGACY_GRAFT_LIMITS,
  openRegularFile,
  privateDirectory,
  protectArchiveFile,
} from "./files";
import { columnsFor, sqlIdentifier, type LegacyRow } from "./sourceSnapshot";

export function archiveThreadFile(sourceThreadId: string): string {
  return `threads/${createHash("sha256").update(sourceThreadId).digest("hex")}.jsonl`;
}

export function encodeArchiveRow(value: unknown): string {
  const encoded = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "bigint") return { type: "bigint", value: item.toString() };
    if (item instanceof Uint8Array)
      return { type: "blob", base64: Buffer.from(item).toString("base64") };
    return item;
  });
  if (Buffer.byteLength(encoded) > LEGACY_GRAFT_LIMITS.cellBytes)
    throw new Error("Legacy history row exceeds the export size limit.");
  return `${encoded}\n`;
}

/** JSONL is inert content; never render this as HTML or execute referenced paths. */
export async function exportLegacyThreads(
  database: DatabaseSync,
  directory: string,
  tableNames: readonly string[],
): Promise<void> {
  const output = await privateDirectory(path.join(directory, "threads"));
  let totalBytes = 0;
  const relatedTables = tableNames.filter((table) => columnsFor(database, table).has("threadId"));
  for (const thread of database.prepare("SELECT * FROM threads ORDER BY id").iterate()) {
    if (typeof thread.id !== "string") throw new Error("Invalid legacy thread ID.");
    const filePath = path.join(directory, archiveThreadFile(thread.id));
    // Rebuild only derived exports while no manifest has admitted any import commands.
    await fs.rm(filePath, { force: true });
    const handle = await fs.open(filePath, "wx", 0o600);
    const append = async (table: string, row: LegacyRow) => {
      const line = encodeArchiveRow({ table, row });
      totalBytes += Buffer.byteLength(line);
      if (totalBytes > LEGACY_GRAFT_LIMITS.exportBytes)
        throw new Error("Legacy history exceeds the automatic export size limit.");
      await handle.writeFile(line);
    };
    try {
      await append("threads", thread);
      if (typeof thread.projectId === "string") {
        const project = database
          .prepare("SELECT * FROM projects WHERE id = ?")
          .get(thread.projectId);
        if (project) await append("projects", project);
      }
      if (typeof thread.worktreeId === "string") {
        const worktree = database
          .prepare("SELECT * FROM worktrees WHERE id = ?")
          .get(thread.worktreeId);
        if (worktree) await append("worktrees", worktree);
      }
      for (const table of relatedTables) {
        const columns = columnsFor(database, table);
        const ordering = [
          columns.has("threadSequence") ? "threadSequence" : null,
          columns.has("partIndex") ? "partIndex" : null,
          columns.has("sequence") ? "sequence" : null,
          "rowid",
        ]
          .filter(Boolean)
          .join(", ");
        for (const row of database
          .prepare(
            `SELECT rowid AS _sourceRowid, * FROM ${sqlIdentifier(table)} WHERE threadId = ? ORDER BY ${ordering}`,
          )
          .iterate(thread.id)) {
          await append(table, row);
        }
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    await protectArchiveFile(filePath);
  }
  await fs.chmod(output, 0o700);
}

async function pathWithinApprovedRoot(
  filePath: string,
  roots: readonly string[],
): Promise<boolean> {
  if (!path.isAbsolute(filePath)) return false;
  for (const root of roots) {
    const relative = path.relative(root, filePath);
    if (
      relative === "" ||
      relative.startsWith(`..${path.sep}`) ||
      relative === ".." ||
      path.isAbsolute(relative)
    )
      continue;
    let cursor = root;
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) continue;
    for (const part of relative.split(path.sep)) {
      cursor = path.join(cursor, part);
      if ((await fs.lstat(cursor)).isSymbolicLink())
        throw new Error("Attachment path traverses a symbolic link.");
    }
    return true;
  }
  return false;
}

export async function archiveLegacyAttachments(
  database: DatabaseSync,
  directory: string,
  approvedRoots: readonly string[],
): Promise<LegacyGraftAttachmentSummary[]> {
  const roots = approvedRoots.map((root) => {
    if (!path.isAbsolute(root)) throw new Error("Attachment roots must be absolute.");
    return path.resolve(root);
  });
  await privateDirectory(path.join(directory, "attachments"));
  const paths = new Set<string>();
  for (const row of database.prepare("SELECT filePath FROM attachments").iterate()) {
    if (typeof row.filePath === "string") paths.add(row.filePath);
  }
  // Legacy user image previews may not have a separate attachments-table record.
  for (const row of database
    .prepare("SELECT metadata FROM message_parts WHERE role = 'user'")
    .iterate()) {
    if (
      typeof row.metadata !== "string" ||
      Buffer.byteLength(row.metadata) > LEGACY_GRAFT_LIMITS.cellBytes
    )
      continue;
    try {
      const metadata: unknown = JSON.parse(row.metadata);
      if (!metadata || typeof metadata !== "object") continue;
      if ("filePaths" in metadata && Array.isArray(metadata.filePaths)) {
        for (const filePath of metadata.filePaths)
          if (typeof filePath === "string") paths.add(filePath);
      }
      if ("imagePreviews" in metadata && Array.isArray(metadata.imagePreviews)) {
        for (const preview of metadata.imagePreviews) {
          if (typeof preview === "string") paths.add(preview);
          else if (
            preview &&
            typeof preview === "object" &&
            "path" in preview &&
            typeof preview.path === "string"
          )
            paths.add(preview.path);
        }
      }
    } catch {
      // The complete original metadata remains in the protected SQLite and JSONL archives.
    }
  }
  const results: LegacyGraftAttachmentSummary[] = [];
  let totalBytes = 0;
  for (const sourcePath of [...paths].sort()) {
    let disposition: LegacyGraftAttachmentSummary["disposition"] = "unsafe";
    let archiveFile: string | null = null;
    try {
      if (!(await pathWithinApprovedRoot(sourcePath, roots))) {
        disposition = "outside-approved-roots";
      } else {
        const stat = await fs.lstat(sourcePath);
        if (!stat.isFile()) throw new Error("Attachment is not a regular file.");
        if (
          stat.size > LEGACY_GRAFT_LIMITS.attachmentBytes ||
          totalBytes + stat.size > LEGACY_GRAFT_LIMITS.totalAttachmentBytes
        ) {
          disposition = "too-large";
        } else {
          const handle = await openRegularFile(sourcePath, LEGACY_GRAFT_LIMITS.attachmentBytes);
          try {
            const data = await handle.readFile();
            if (
              data.length > LEGACY_GRAFT_LIMITS.attachmentBytes ||
              totalBytes + data.length > LEGACY_GRAFT_LIMITS.totalAttachmentBytes
            )
              throw new Error("Attachment grew during archive copy.");
            archiveFile = `attachments/${createHash("sha256").update(sourcePath).digest("hex")}.bin`;
            const target = path.join(directory, archiveFile);
            await fs.rm(target, { force: true });
            await fs.writeFile(target, data, { flag: "wx", mode: 0o600 });
            await protectArchiveFile(target);
            totalBytes += data.length;
            disposition = "copied";
          } finally {
            await handle.close();
          }
        }
      }
    } catch (cause) {
      disposition = (cause as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unsafe";
      archiveFile = null;
    }
    results.push({ sourcePath, archiveFile, disposition });
  }
  return results;
}
