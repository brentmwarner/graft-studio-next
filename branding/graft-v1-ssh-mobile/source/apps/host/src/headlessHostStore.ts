import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Sqlite from "better-sqlite3";

export type HeadlessProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "copilot"
  | "cursor"
  | "opencode"
  | "pi";

export interface HeadlessProjectRow {
  id: string;
  name: string;
  repoPath: string;
  projectKind: "repo";
  spaceId: string | null;
  sortOrder: number;
  createdAt: number;
}

export interface HeadlessWorktreeRow {
  id: string;
  projectId: string;
  path: string;
  branchName: string;
  baseBranch: string;
  status: "active" | "deleted";
  createdAt: number;
  lastUsedAt: number;
}

export interface HeadlessThreadRow {
  id: string;
  projectId: string;
  title: string;
  mode: "local" | "worktree";
  worktreeId: string | null;
  localPath: string | null;
  trackedBranch: string | null;
  trackedPrUrl: string | null;
  trackedPrNumber: number | null;
  providerHint: HeadlessProviderId | null;
  modelName: string | null;
  executionMode: "byom" | null;
  approvalPolicy: string | null;
  cliSessionId: string | null;
  historySequence: number;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
  autoNamed: number;
  autoNameAttempts: number;
  parentThreadId: string | null;
  agentName: string | null;
  providerChangeAllowed: true;
}

export interface HeadlessEventRow {
  id: string;
  threadId: string;
  runId: string | null;
  threadSequence: number;
  type: string;
  payload: unknown;
  createdAt: number;
}

export interface HeadlessPartRow {
  id: string;
  threadId: string;
  runId: string | null;
  threadSequence: number;
  parentSubAgentPartId: string | null;
  role: "user" | "assistant" | "system";
  partType: string;
  partIndex: number;
  status: "streaming" | "complete" | "error";
  content: string;
  metadata: string;
  createdAt: number;
  updatedAt: number;
}

export interface HeadlessRunRow {
  id: string;
  threadId: string;
  threadSequence: number;
  projectId: string;
  threadTitle: string;
  kind: "agent";
  mode: "local" | "worktree";
  cwdPath: string;
  worktreeId: string | null;
  modelProvider: string | null;
  modelName: string | null;
  executionMode: "byom";
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  createdAt: number;
  endedAt: number | null;
  queueWaitMs: number | null;
  errorMessage: string | null;
  parentRunId: string | null;
  diffAdditions: number | null;
  diffDeletions: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
}

interface ProjectDbRow {
  id: string;
  name: string;
  repoPath: string;
  spaceId: string | null;
  sortOrder: number;
  createdAt: number;
}

interface WorktreeDbRow {
  id: string;
  projectId: string;
  path: string;
  branchName: string;
  baseBranch: string;
  status: "active" | "deleted";
  createdAt: number;
  lastUsedAt: number;
}

interface ThreadDbRow extends Omit<
  HeadlessThreadRow,
  "providerChangeAllowed"
> {}

interface EventDbRow extends Omit<HeadlessEventRow, "payload"> {
  payloadJson: string;
}

interface RunDbRow extends HeadlessRunRow {}

const SCHEMA_VERSION = 1;

function asProject(row: ProjectDbRow): HeadlessProjectRow {
  return { ...row, projectKind: "repo" };
}

function asWorktree(row: WorktreeDbRow): HeadlessWorktreeRow {
  return row;
}

function asThread(row: ThreadDbRow): HeadlessThreadRow {
  return { ...row, providerChangeAllowed: true };
}

function asEvent(row: EventDbRow): HeadlessEventRow {
  return {
    id: row.id,
    threadId: row.threadId,
    runId: row.runId,
    threadSequence: row.threadSequence,
    type: row.type,
    payload: JSON.parse(row.payloadJson) as unknown,
    createdAt: row.createdAt,
  };
}

export class HeadlessHostStore {
  private readonly database: Sqlite.Database;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    this.database = new Sqlite(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.database.close();
  }

  listProjects(): HeadlessProjectRow[] {
    const rows = this.database
      .prepare(
        `SELECT id, name, repo_path AS repoPath, space_id AS spaceId,
                sort_order AS sortOrder, created_at AS createdAt
         FROM headless_projects
         ORDER BY sort_order ASC, created_at ASC`,
      )
      .all() as ProjectDbRow[];
    return rows.map(asProject);
  }

  getProject(projectId: string): HeadlessProjectRow | null {
    const row = this.database
      .prepare(
        `SELECT id, name, repo_path AS repoPath, space_id AS spaceId,
                sort_order AS sortOrder, created_at AS createdAt
         FROM headless_projects WHERE id = ?`,
      )
      .get(projectId) as ProjectDbRow | undefined;
    return row ? asProject(row) : null;
  }

  getProjectByPath(repoPath: string): HeadlessProjectRow | null {
    const row = this.database
      .prepare(
        `SELECT id, name, repo_path AS repoPath, space_id AS spaceId,
                sort_order AS sortOrder, created_at AS createdAt
         FROM headless_projects WHERE repo_path = ?`,
      )
      .get(repoPath) as ProjectDbRow | undefined;
    return row ? asProject(row) : null;
  }

  createProject(input: { name: string; repoPath: string }): HeadlessProjectRow {
    const existing = this.getProjectByPath(input.repoPath);
    if (existing) return existing;
    const createdAt = Date.now();
    const sortOrder = this.listProjects().length;
    const project: HeadlessProjectRow = {
      id: randomUUID(),
      name: input.name,
      repoPath: input.repoPath,
      projectKind: "repo",
      spaceId: null,
      sortOrder,
      createdAt,
    };
    this.database
      .prepare(
        `INSERT INTO headless_projects
           (id, name, repo_path, space_id, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.repoPath,
        project.spaceId,
        project.sortOrder,
        project.createdAt,
      );
    return project;
  }

  reorderProjects(orderedIds: readonly string[]): boolean {
    const knownIds = new Set(this.listProjects().map((project) => project.id));
    if (
      orderedIds.length !== knownIds.size ||
      orderedIds.some((id) => !knownIds.has(id))
    ) {
      return false;
    }
    const update = this.database.prepare(
      "UPDATE headless_projects SET sort_order = ? WHERE id = ?",
    );
    this.database.transaction(() => {
      orderedIds.forEach((id, index) => update.run(index, id));
    })();
    return true;
  }

  renameProject(projectId: string, name: string): boolean {
    return (
      this.database
        .prepare("UPDATE headless_projects SET name = ? WHERE id = ?")
        .run(name, projectId).changes === 1
    );
  }

  removeProject(projectId: string): boolean {
    return (
      this.database
        .prepare("DELETE FROM headless_projects WHERE id = ?")
        .run(projectId).changes === 1
    );
  }

  listWorktrees(
    projectId: string,
    includeDeleted = false,
  ): HeadlessWorktreeRow[] {
    const rows = this.database
      .prepare(
        `SELECT id, project_id AS projectId, path, branch_name AS branchName,
                base_branch AS baseBranch, status, created_at AS createdAt,
                last_used_at AS lastUsedAt
         FROM headless_worktrees
         WHERE project_id = ? ${includeDeleted ? "" : "AND status = 'active'"}
         ORDER BY created_at ASC`,
      )
      .all(projectId) as WorktreeDbRow[];
    return rows.map(asWorktree);
  }

  getWorktree(
    projectId: string,
    worktreeId: string,
  ): HeadlessWorktreeRow | null {
    const row = this.database
      .prepare(
        `SELECT id, project_id AS projectId, path, branch_name AS branchName,
                base_branch AS baseBranch, status, created_at AS createdAt,
                last_used_at AS lastUsedAt
         FROM headless_worktrees
         WHERE project_id = ? AND id = ?`,
      )
      .get(projectId, worktreeId) as WorktreeDbRow | undefined;
    return row ? asWorktree(row) : null;
  }

  createWorktree(input: {
    projectId: string;
    path: string;
    branchName: string;
    baseBranch: string;
  }): HeadlessWorktreeRow {
    const createdAt = Date.now();
    const row: HeadlessWorktreeRow = {
      id: randomUUID(),
      ...input,
      status: "active",
      createdAt,
      lastUsedAt: createdAt,
    };
    this.database
      .prepare(
        `INSERT INTO headless_worktrees
           (id, project_id, path, branch_name, base_branch, status,
            created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(
        row.id,
        row.projectId,
        row.path,
        row.branchName,
        row.baseBranch,
        row.createdAt,
        row.lastUsedAt,
      );
    return row;
  }

  markWorktreeDeleted(worktreeId: string): boolean {
    return (
      this.database
        .prepare(
          "UPDATE headless_worktrees SET status = 'deleted', last_used_at = ? WHERE id = ?",
        )
        .run(Date.now(), worktreeId).changes === 1
    );
  }

  listThreads(input: {
    projectId?: string;
    archived?: boolean;
  }): HeadlessThreadRow[] {
    const clauses: string[] = [];
    const parameters: unknown[] = [];
    if (input.projectId) {
      clauses.push("project_id = ?");
      parameters.push(input.projectId);
    }
    if (input.archived === true) clauses.push("archived_at IS NOT NULL");
    if (input.archived === false) clauses.push("archived_at IS NULL");
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database
      .prepare(`${this.threadSelect()} ${where} ORDER BY updated_at DESC`)
      .all(...parameters) as ThreadDbRow[];
    return rows.map(asThread);
  }

  getThread(threadId: string): HeadlessThreadRow | null {
    const row = this.database
      .prepare(`${this.threadSelect()} WHERE id = ?`)
      .get(threadId) as ThreadDbRow | undefined;
    return row ? asThread(row) : null;
  }

  createThread(input: {
    projectId: string;
    title: string;
    mode: "local" | "worktree";
    worktreeId: string | null;
    localPath: string;
    providerHint: HeadlessProviderId;
    modelName: string | null;
    trackedBranch?: string | null;
    parentThreadId?: string | null;
  }): HeadlessThreadRow {
    const now = Date.now();
    const row: HeadlessThreadRow = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title,
      mode: input.mode,
      worktreeId: input.worktreeId,
      localPath: input.localPath,
      trackedBranch: input.trackedBranch ?? null,
      trackedPrUrl: null,
      trackedPrNumber: null,
      providerHint: input.providerHint,
      modelName: input.modelName,
      executionMode: "byom",
      approvalPolicy: null,
      cliSessionId: null,
      historySequence: 0,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      autoNamed: 0,
      autoNameAttempts: 0,
      parentThreadId: input.parentThreadId ?? null,
      agentName: null,
      providerChangeAllowed: true,
    };
    this.database
      .prepare(
        `INSERT INTO headless_threads
           (id, project_id, title, mode, worktree_id, local_path,
            tracked_branch, tracked_pr_url, tracked_pr_number, provider_hint,
            model_name, execution_mode, approval_policy, cli_session_id,
            history_sequence, archived_at, created_at, updated_at, auto_named,
            auto_name_attempts, parent_thread_id, agent_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.projectId,
        row.title,
        row.mode,
        row.worktreeId,
        row.localPath,
        row.trackedBranch,
        row.trackedPrUrl,
        row.trackedPrNumber,
        row.providerHint,
        row.modelName,
        row.executionMode,
        row.approvalPolicy,
        row.cliSessionId,
        row.historySequence,
        row.archivedAt,
        row.createdAt,
        row.updatedAt,
        row.autoNamed,
        row.autoNameAttempts,
        row.parentThreadId,
        row.agentName,
      );
    return row;
  }

  updateThread(
    threadId: string,
    updates: Partial<
      Pick<
        HeadlessThreadRow,
        | "title"
        | "mode"
        | "worktreeId"
        | "localPath"
        | "trackedBranch"
        | "trackedPrUrl"
        | "trackedPrNumber"
        | "providerHint"
        | "modelName"
        | "executionMode"
        | "approvalPolicy"
        | "cliSessionId"
        | "archivedAt"
      >
    >,
  ): boolean {
    const columns: Record<string, string> = {
      title: "title",
      mode: "mode",
      worktreeId: "worktree_id",
      localPath: "local_path",
      trackedBranch: "tracked_branch",
      trackedPrUrl: "tracked_pr_url",
      trackedPrNumber: "tracked_pr_number",
      providerHint: "provider_hint",
      modelName: "model_name",
      executionMode: "execution_mode",
      approvalPolicy: "approval_policy",
      cliSessionId: "cli_session_id",
      archivedAt: "archived_at",
    };
    const entries = Object.entries(updates).filter(([key]) => key in columns);
    if (entries.length === 0) return this.getThread(threadId) !== null;
    const assignments = entries.map(([key]) => `${columns[key]} = ?`);
    const values = entries.map(([, value]) => value);
    return (
      this.database
        .prepare(
          `UPDATE headless_threads SET ${assignments.join(", ")}, updated_at = ? WHERE id = ?`,
        )
        .run(...values, Date.now(), threadId).changes === 1
    );
  }

  deleteThread(threadId: string): boolean {
    return (
      this.database
        .prepare("DELETE FROM headless_threads WHERE id = ?")
        .run(threadId).changes === 1
    );
  }

  forkThread(threadId: string): HeadlessThreadRow | null {
    const source = this.getThread(threadId);
    if (!source) return null;
    const fork = this.createThread({
      projectId: source.projectId,
      title: `${source.title} (fork)`,
      mode: source.mode,
      worktreeId: source.worktreeId,
      localPath: source.localPath ?? "",
      providerHint: source.providerHint ?? "openai",
      modelName: source.modelName,
      trackedBranch: source.trackedBranch,
      parentThreadId: source.id,
    });
    const events = this.listEvents(threadId, 10_000);
    const parts = this.listParts(threadId, 10_000);
    this.database.transaction(() => {
      for (const event of events) {
        this.appendEvent({
          threadId: fork.id,
          runId: null,
          type: event.type,
          payload: event.payload,
        });
      }
      for (const part of parts) {
        this.appendPart({
          threadId: fork.id,
          runId: null,
          role: part.role,
          partType: part.partType,
          status: part.status,
          content: part.content,
          metadata: part.metadata,
        });
      }
    })();
    return fork;
  }

  appendEvent(input: {
    threadId: string;
    runId: string | null;
    type: string;
    payload: unknown;
  }): HeadlessEventRow {
    const row: HeadlessEventRow = {
      id: randomUUID(),
      threadId: input.threadId,
      runId: input.runId,
      threadSequence: this.nextSequence(input.threadId),
      type: input.type,
      payload: input.payload,
      createdAt: Date.now(),
    };
    this.database
      .prepare(
        `INSERT INTO headless_thread_events
           (id, thread_id, run_id, thread_sequence, type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.threadId,
        row.runId,
        row.threadSequence,
        row.type,
        JSON.stringify(row.payload),
        row.createdAt,
      );
    return row;
  }

  listEvents(threadId: string, limit: number): HeadlessEventRow[] {
    const rows = this.database
      .prepare(
        `SELECT id, thread_id AS threadId, run_id AS runId,
                thread_sequence AS threadSequence, type,
                payload_json AS payloadJson, created_at AS createdAt
         FROM headless_thread_events WHERE thread_id = ?
         ORDER BY thread_sequence DESC LIMIT ?`,
      )
      .all(threadId, limit) as EventDbRow[];
    return rows.reverse().map(asEvent);
  }

  appendPart(input: {
    threadId: string;
    runId: string | null;
    role: HeadlessPartRow["role"];
    partType: string;
    status: HeadlessPartRow["status"];
    content: string;
    metadata?: string;
  }): HeadlessPartRow {
    const now = Date.now();
    const row: HeadlessPartRow = {
      id: randomUUID(),
      threadId: input.threadId,
      runId: input.runId,
      threadSequence: this.nextSequence(input.threadId),
      parentSubAgentPartId: null,
      role: input.role,
      partType: input.partType,
      partIndex: this.nextPartIndex(input.threadId),
      status: input.status,
      content: input.content,
      metadata: input.metadata ?? "{}",
      createdAt: now,
      updatedAt: now,
    };
    this.database
      .prepare(
        `INSERT INTO headless_message_parts
           (id, thread_id, run_id, thread_sequence, parent_sub_agent_part_id,
            role, part_type, part_index, status, content, metadata,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.threadId,
        row.runId,
        row.threadSequence,
        row.parentSubAgentPartId,
        row.role,
        row.partType,
        row.partIndex,
        row.status,
        row.content,
        row.metadata,
        row.createdAt,
        row.updatedAt,
      );
    return row;
  }

  updatePart(
    partId: string,
    updates: {
      content?: string;
      status?: HeadlessPartRow["status"];
      metadata?: string;
    },
  ): HeadlessPartRow | null {
    const current = this.getPart(partId);
    if (!current) return null;
    const updated: HeadlessPartRow = {
      ...current,
      ...updates,
      updatedAt: Date.now(),
    };
    this.database
      .prepare(
        `UPDATE headless_message_parts
         SET content = ?, status = ?, metadata = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        updated.content,
        updated.status,
        updated.metadata,
        updated.updatedAt,
        partId,
      );
    return updated;
  }

  listParts(threadId: string, limit: number): HeadlessPartRow[] {
    const rows = this.database
      .prepare(
        `${this.partSelect()} WHERE thread_id = ?
         ORDER BY part_index DESC LIMIT ?`,
      )
      .all(threadId, limit) as HeadlessPartRow[];
    return rows.reverse();
  }

  createRun(input: {
    thread: HeadlessThreadRow;
    cwdPath: string;
    provider: HeadlessProviderId;
    modelName: string | null;
  }): HeadlessRunRow {
    const row: HeadlessRunRow = {
      id: randomUUID(),
      threadId: input.thread.id,
      threadSequence: this.nextRunSequence(input.thread.id),
      projectId: input.thread.projectId,
      threadTitle: input.thread.title,
      kind: "agent",
      mode: input.thread.mode,
      cwdPath: input.cwdPath,
      worktreeId: input.thread.worktreeId,
      modelProvider: input.provider,
      modelName: input.modelName,
      executionMode: "byom",
      status: "queued",
      createdAt: Date.now(),
      endedAt: null,
      queueWaitMs: null,
      errorMessage: null,
      parentRunId: null,
      diffAdditions: null,
      diffDeletions: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
    };
    this.database
      .prepare(
        `INSERT INTO headless_runs
           (id, thread_id, thread_sequence, project_id, thread_title, kind,
            mode, cwd_path, worktree_id, model_provider, model_name,
            execution_mode, status, created_at, ended_at, queue_wait_ms,
            error_message, parent_run_id, diff_additions, diff_deletions,
            input_tokens, output_tokens, cache_read_tokens,
            cache_creation_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...this.runValues(row));
    return row;
  }

  listRuns(projectId?: string): HeadlessRunRow[] {
    const where = projectId ? "WHERE project_id = ?" : "";
    return this.database
      .prepare(`${this.runSelect()} ${where} ORDER BY created_at DESC`)
      .all(...(projectId ? [projectId] : [])) as RunDbRow[];
  }

  getRun(runId: string): HeadlessRunRow | null {
    return (
      (this.database.prepare(`${this.runSelect()} WHERE id = ?`).get(runId) as
        | RunDbRow
        | undefined) ?? null
    );
  }

  updateRun(
    runId: string,
    updates: {
      status: HeadlessRunRow["status"];
      errorMessage?: string | null;
      endedAt?: number | null;
    },
  ): boolean {
    return (
      this.database
        .prepare(
          `UPDATE headless_runs
           SET status = ?, error_message = ?, ended_at = ? WHERE id = ?`,
        )
        .run(
          updates.status,
          updates.errorMessage ?? null,
          updates.endedAt ?? null,
          runId,
        ).changes === 1
    );
  }

  private getPart(partId: string): HeadlessPartRow | null {
    return (
      (this.database
        .prepare(`${this.partSelect()} WHERE id = ?`)
        .get(partId) as HeadlessPartRow | undefined) ?? null
    );
  }

  private nextSequence(threadId: string): number {
    const row = this.database
      .prepare(
        `SELECT MAX(sequence_value) AS value FROM (
           SELECT MAX(thread_sequence) AS sequence_value
             FROM headless_thread_events WHERE thread_id = ?
           UNION ALL
           SELECT MAX(thread_sequence) AS sequence_value
             FROM headless_message_parts WHERE thread_id = ?
         )`,
      )
      .get(threadId, threadId) as { value: number | null };
    const next = (row.value ?? 0) + 1;
    this.database
      .prepare(
        "UPDATE headless_threads SET history_sequence = ?, updated_at = ? WHERE id = ?",
      )
      .run(next, Date.now(), threadId);
    return next;
  }

  private nextPartIndex(threadId: string): number {
    const row = this.database
      .prepare(
        "SELECT COALESCE(MAX(part_index), -1) + 1 AS value FROM headless_message_parts WHERE thread_id = ?",
      )
      .get(threadId) as { value: number };
    return row.value;
  }

  private nextRunSequence(threadId: string): number {
    const row = this.database
      .prepare(
        "SELECT COALESCE(MAX(thread_sequence), 0) + 1 AS value FROM headless_runs WHERE thread_id = ?",
      )
      .get(threadId) as { value: number };
    return row.value;
  }

  private threadSelect(): string {
    return `SELECT id, project_id AS projectId, title, mode,
                   worktree_id AS worktreeId, local_path AS localPath,
                   tracked_branch AS trackedBranch,
                   tracked_pr_url AS trackedPrUrl,
                   tracked_pr_number AS trackedPrNumber,
                   provider_hint AS providerHint, model_name AS modelName,
                   execution_mode AS executionMode,
                   approval_policy AS approvalPolicy,
                   cli_session_id AS cliSessionId,
                   history_sequence AS historySequence,
                   archived_at AS archivedAt, created_at AS createdAt,
                   updated_at AS updatedAt, auto_named AS autoNamed,
                   auto_name_attempts AS autoNameAttempts,
                   parent_thread_id AS parentThreadId, agent_name AS agentName
            FROM headless_threads`;
  }

  private partSelect(): string {
    return `SELECT id, thread_id AS threadId, run_id AS runId,
                   thread_sequence AS threadSequence,
                   parent_sub_agent_part_id AS parentSubAgentPartId,
                   role, part_type AS partType, part_index AS partIndex,
                   status, content, metadata, created_at AS createdAt,
                   updated_at AS updatedAt
            FROM headless_message_parts`;
  }

  private runSelect(): string {
    return `SELECT id, thread_id AS threadId,
                   thread_sequence AS threadSequence,
                   project_id AS projectId, thread_title AS threadTitle,
                   kind, mode, cwd_path AS cwdPath, worktree_id AS worktreeId,
                   model_provider AS modelProvider, model_name AS modelName,
                   execution_mode AS executionMode, status,
                   created_at AS createdAt, ended_at AS endedAt,
                   queue_wait_ms AS queueWaitMs, error_message AS errorMessage,
                   parent_run_id AS parentRunId,
                   diff_additions AS diffAdditions,
                   diff_deletions AS diffDeletions,
                   input_tokens AS inputTokens, output_tokens AS outputTokens,
                   cache_read_tokens AS cacheReadTokens,
                   cache_creation_tokens AS cacheCreationTokens
            FROM headless_runs`;
  }

  private runValues(row: HeadlessRunRow): unknown[] {
    return [
      row.id,
      row.threadId,
      row.threadSequence,
      row.projectId,
      row.threadTitle,
      row.kind,
      row.mode,
      row.cwdPath,
      row.worktreeId,
      row.modelProvider,
      row.modelName,
      row.executionMode,
      row.status,
      row.createdAt,
      row.endedAt,
      row.queueWaitMs,
      row.errorMessage,
      row.parentRunId,
      row.diffAdditions,
      row.diffDeletions,
      row.inputTokens,
      row.outputTokens,
      row.cacheReadTokens,
      row.cacheCreationTokens,
    ];
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS headless_schema (
        version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS headless_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        repo_path TEXT NOT NULL UNIQUE,
        space_id TEXT,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS headless_worktrees (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES headless_projects(id) ON DELETE CASCADE,
        path TEXT NOT NULL UNIQUE,
        branch_name TEXT NOT NULL,
        base_branch TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS headless_threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES headless_projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('local', 'worktree')),
        worktree_id TEXT REFERENCES headless_worktrees(id) ON DELETE SET NULL,
        local_path TEXT,
        tracked_branch TEXT,
        tracked_pr_url TEXT,
        tracked_pr_number INTEGER,
        provider_hint TEXT,
        model_name TEXT,
        execution_mode TEXT,
        approval_policy TEXT,
        cli_session_id TEXT,
        history_sequence INTEGER NOT NULL DEFAULT 0,
        archived_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        auto_named INTEGER NOT NULL DEFAULT 0,
        auto_name_attempts INTEGER NOT NULL DEFAULT 0,
        parent_thread_id TEXT REFERENCES headless_threads(id) ON DELETE SET NULL,
        agent_name TEXT
      );
      CREATE TABLE IF NOT EXISTS headless_thread_events (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES headless_threads(id) ON DELETE CASCADE,
        run_id TEXT,
        thread_sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(thread_id, thread_sequence)
      );
      CREATE TABLE IF NOT EXISTS headless_message_parts (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES headless_threads(id) ON DELETE CASCADE,
        run_id TEXT,
        thread_sequence INTEGER NOT NULL,
        parent_sub_agent_part_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        part_type TEXT NOT NULL,
        part_index INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('streaming', 'complete', 'error')),
        content TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(thread_id, thread_sequence),
        UNIQUE(thread_id, part_index)
      );
      CREATE TABLE IF NOT EXISTS headless_runs (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES headless_threads(id) ON DELETE CASCADE,
        thread_sequence INTEGER NOT NULL,
        project_id TEXT NOT NULL REFERENCES headless_projects(id) ON DELETE CASCADE,
        thread_title TEXT NOT NULL,
        kind TEXT NOT NULL,
        mode TEXT NOT NULL,
        cwd_path TEXT NOT NULL,
        worktree_id TEXT,
        model_provider TEXT,
        model_name TEXT,
        execution_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        ended_at INTEGER,
        queue_wait_ms INTEGER,
        error_message TEXT,
        parent_run_id TEXT,
        diff_additions INTEGER,
        diff_deletions INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_creation_tokens INTEGER,
        UNIQUE(thread_id, thread_sequence)
      );
      CREATE INDEX IF NOT EXISTS headless_threads_project_updated
        ON headless_threads(project_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS headless_events_thread_sequence
        ON headless_thread_events(thread_id, thread_sequence);
      CREATE INDEX IF NOT EXISTS headless_parts_thread_index
        ON headless_message_parts(thread_id, part_index);
    `);
    const row = this.database
      .prepare("SELECT version FROM headless_schema LIMIT 1")
      .get() as { version: number } | undefined;
    if (!row) {
      this.database
        .prepare("INSERT INTO headless_schema (version) VALUES (?)")
        .run(SCHEMA_VERSION);
      return;
    }
    if (row.version !== SCHEMA_VERSION) {
      throw new Error(
        `Unsupported headless host schema version ${row.version}`,
      );
    }
  }
}
