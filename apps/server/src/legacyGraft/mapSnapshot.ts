import type { DatabaseSync } from "node:sqlite";
import * as path from "node:path";

import {
  CommandId,
  EventId,
  MessageId,
  OrchestrationCommand,
  ProjectId,
  ThreadId,
  type LegacyGraftImportSummary,
  type LegacyGraftThreadSummary,
  type ModelSelection,
  type ThreadHandoffImportedMessage,
} from "@graft/contracts";
import { Schema } from "effect";

import { archiveThreadFile } from "./archive";
import { LEGACY_GRAFT_LIMITS, stableLegacyId } from "./files";
import { columnsFor, type LegacyRow, type LegacySnapshot } from "./sourceSnapshot";

export interface LegacyGraftPlan {
  version: 1;
  snapshotSha256: string;
  summary: LegacyGraftImportSummary;
  commands: OrchestrationCommand[];
  blockedThreadIds: ThreadId[];
}

function requiredText(row: LegacyRow, field: string): string {
  const value = row[field];
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    Buffer.byteLength(value) > LEGACY_GRAFT_LIMITS.cellBytes
  )
    throw new Error(`Invalid legacy ${field}.`);
  return value;
}

function optionalText(row: LegacyRow, field: string): string | null {
  const value = row[field];
  return typeof value === "string" && value.trim() ? value : null;
}

function date(row: LegacyRow, field: string): string {
  const value = row[field];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    !Number.isFinite(new Date(value).getTime())
  )
    throw new Error(`Invalid legacy ${field}.`);
  return new Date(value).toISOString();
}

function modelSelection(row: LegacyRow): ModelSelection | null {
  const model = optionalText(row, "modelName");
  if (!model || row.executionMode === "hosted") return null;
  // These identify the legacy runtimes, not their credential/account instances.
  switch (row.providerHint) {
    case "openai":
      return { provider: "codex", model };
    case "anthropic":
      return { provider: "claudeAgent", model };
    case "google":
      return { provider: "antigravity", model };
    case "cursor":
      return { provider: "cursor", model };
    case "opencode":
      return { provider: "opencode", model };
    case "pi":
      return { provider: "pi", model };
    default:
      return null;
  }
}

/** Converts inert saved history only. Never creates provider sessions or runnable automations. */
export function mapLegacySnapshot(
  database: DatabaseSync,
  snapshot: LegacySnapshot,
  preparedAt: string,
): LegacyGraftPlan {
  const commands: OrchestrationCommand[] = [];
  const blockedThreadIds: ThreadId[] = [];
  const threads: LegacyGraftThreadSummary[] = [];
  const projects = new Map<string, ProjectId>();
  const id = (kind: string, original: string) => stableLegacyId(snapshot.sourceId, kind, original);
  const commandId = (kind: string, original: string) =>
    CommandId.makeUnsafe(id(`command-${kind}`, original));
  const warnings = [
    "Imported conversations are read-only. Native sessions are not resumed; start a separate fresh chat to continue working.",
    "Tools, reasoning, system messages, run events, plans, checkpoints, provider-instance metadata, spaces, project actions and preferences are preserved in the full archive. Their legacy execution behavior is not activated.",
    "Legacy automations, pending approvals, mobile pairings and MCP grants remain archive-only and are not activated.",
    "Repository and worktree paths are preserved in place. Missing paths need to be reconnected; worktrees are not moved or recreated.",
  ];
  let importedMessages = 0;
  let totalTextBytes = 0;
  const add = (command: unknown) =>
    commands.push(Schema.decodeUnknownSync(OrchestrationCommand)(command));
  for (const row of database.prepare("SELECT * FROM projects ORDER BY createdAt, id").iterate()) {
    const sourceId = requiredText(row, "id");
    const workspaceRoot = optionalText(row, "repoPath");
    if (
      !workspaceRoot ||
      !path.isAbsolute(workspaceRoot) ||
      (row.projectKind !== "repo" && row.projectKind !== "desktop")
    ) {
      warnings.push(
        `Project ${sourceId} is archive-only because its workspace or kind is unsupported.`,
      );
      continue;
    }
    const projectId = ProjectId.makeUnsafe(id("project", sourceId));
    projects.set(sourceId, projectId);
    add({
      type: "project.create",
      commandId: commandId("project", sourceId),
      projectId,
      kind: row.projectKind === "repo" ? "project" : "chat",
      title: requiredText(row, "name"),
      workspaceRoot,
      createdAt: date(row, "createdAt"),
      createWorkspaceRootIfMissing: false,
    });
  }
  const partsHaveSequence = columnsFor(database, "message_parts").has("threadSequence");
  const partsQuery = database.prepare(
    `SELECT rowid AS _sourceRowid, * FROM message_parts WHERE threadId = ? ORDER BY ${partsHaveSequence ? "threadSequence, " : "createdAt, "}partIndex, rowid`,
  );
  for (const row of database.prepare("SELECT * FROM threads ORDER BY createdAt, id").iterate()) {
    const sourceThreadId = requiredText(row, "id");
    const projectId = projects.get(requiredText(row, "projectId"));
    const selection = modelSelection(row);
    const reasons: string[] = [];
    const partCount = Number(
      database
        .prepare("SELECT count(*) AS count FROM message_parts WHERE threadId = ?")
        .get(sourceThreadId)?.count,
    );
    if (!projectId) reasons.push("The original project requires manual reconnection.");
    if (!selection)
      reasons.push(
        "The original provider, hosted execution mode, or model has no verified migration mapping.",
      );
    if (
      !partCount &&
      Number(
        database
          .prepare("SELECT count(*) AS count FROM runs WHERE threadId = ?")
          .get(sourceThreadId)?.count,
      ) > 0
    )
      reasons.push(
        "History is available as original run events in the archive; structured transcript parts are absent.",
      );
    let worktree: LegacyRow | undefined;
    if (typeof row.worktreeId === "string")
      worktree = database.prepare("SELECT * FROM worktrees WHERE id = ?").get(row.worktreeId);
    const worktreePath =
      row.mode === "worktree"
        ? optionalText(worktree ?? row, worktree ? "path" : "localPath")
        : null;
    if (row.mode !== "local" && row.mode !== "worktree")
      reasons.push("The original execution mode is unsupported.");
    if (row.mode === "worktree" && (!worktreePath || !path.isAbsolute(worktreePath)))
      reasons.push("The original worktree path is unavailable.");
    const localPath = optionalText(row, "localPath");
    if (localPath && !path.isAbsolute(localPath))
      reasons.push("The saved working directory is not absolute.");
    const threadId = ThreadId.makeUnsafe(id("thread", sourceThreadId));
    const canImport = projectId !== undefined && selection !== null && reasons.length === 0;
    threads.push({
      sourceThreadId,
      title: requiredText(row, "title"),
      provider: optionalText(row, "providerHint"),
      importedThreadId: canImport ? threadId : null,
      disposition: canImport ? "reconnect-required" : "archive-only",
      reasons: canImport
        ? [
            "Read-only imported history. Start a separate fresh chat; native resume is not available.",
          ]
        : reasons,
      archiveFile: archiveThreadFile(sourceThreadId),
    });
    if (!canImport || !projectId || !selection) continue;
    blockedThreadIds.push(threadId);
    const branch =
      optionalText(row, "trackedBranch") ??
      (worktree ? optionalText(worktree, "branchName") : null);
    add({
      type: "thread.create",
      commandId: commandId("thread", sourceThreadId),
      threadId,
      projectId,
      title: requiredText(row, "title"),
      modelSelection: selection,
      runtimeMode: "approval-required",
      interactionMode: "default",
      envMode: row.mode,
      branch,
      worktreePath,
      workingDirectory: localPath,
      associatedWorktreePath: worktreePath,
      associatedWorktreeBranch: worktreePath ? branch : null,
      createdAt: date(row, "createdAt"),
    });
    const messages: ThreadHandoffImportedMessage[] = [];
    for (const part of partsQuery.iterate(sourceThreadId)) {
      if (
        (part.role !== "user" && part.role !== "assistant") ||
        part.partType !== "text" ||
        typeof part.content !== "string"
      )
        continue;
      totalTextBytes += Buffer.byteLength(part.content);
      if (
        totalTextBytes > LEGACY_GRAFT_LIMITS.planBytes / 2 ||
        Buffer.byteLength(part.content) > LEGACY_GRAFT_LIMITS.cellBytes
      )
        throw new Error("Legacy transcript exceeds automatic import text limits.");
      importedMessages += 1;
      messages.push({
        messageId: MessageId.makeUnsafe(id("message", requiredText(part, "id"))),
        role: part.role,
        text: part.content,
        createdAt: date(part, "createdAt"),
        updatedAt: date(part, "updatedAt"),
      });
    }
    for (let offset = 0; offset < messages.length; offset += 100) {
      add({
        type: "thread.messages.import",
        commandId: commandId("messages", `${sourceThreadId}:${offset}`),
        threadId,
        messages: messages.slice(offset, offset + 100),
        createdAt: date(row, "updatedAt"),
      });
    }
    add({
      type: "thread.activity.append",
      commandId: commandId("archive", sourceThreadId),
      threadId,
      activity: {
        id: EventId.makeUnsafe(id("archive", sourceThreadId)),
        tone: "info",
        kind: "legacy-graft.import",
        summary:
          "Read-only Graft history. Start a separate fresh chat to continue working. Complete original history is retained in the legacy archive.",
        payload: {
          sourceId: snapshot.sourceId,
          sourceThreadId,
          archiveFile: archiveThreadFile(sourceThreadId),
          resumeStatus: "reconnect-required",
          sourceProvider: optionalText(row, "providerHint"),
          sourceSessionId: optionalText(row, "cliSessionId"),
          sourceProviderInstanceId: optionalText(row, "providerInstanceId"),
          sourceSessionProviderInstanceId: optionalText(row, "cliSessionProviderInstanceId"),
          parentThreadId: optionalText(row, "parentThreadId"),
          agentName: optionalText(row, "agentName"),
          originalArchivedAt: row.archivedAt ?? null,
        },
        turnId: null,
        createdAt: date(row, "updatedAt"),
      },
      createdAt: date(row, "updatedAt"),
    });
    if (typeof row.archivedAt === "number")
      add({
        type: "thread.archive",
        commandId: commandId("archive-state", sourceThreadId),
        threadId,
      });
  }
  return {
    version: 1,
    snapshotSha256: snapshot.sha256,
    commands,
    blockedThreadIds,
    summary: {
      version: 1,
      sourceId: snapshot.sourceId,
      sourceSchemaVersion: snapshot.schemaVersion,
      preparedAt,
      sourceTableCounts: snapshot.tables,
      importedProjects: projects.size,
      importedThreads: blockedThreadIds.length,
      importedMessages,
      archiveOnlyThreads: threads.length - blockedThreadIds.length,
      resumedThreads: 0,
      archivedAutomations: snapshot.tables.automations ?? 0,
      threads,
      attachments: [],
      warnings,
    },
  };
}
