import { execFile } from "node:child_process";
import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  GRAFT_DESKTOP_V1_HOST_COMMAND_CAPABILITIES,
  type GraftDesktopCapability,
  type GraftDesktopJsonValue,
} from "@graft/shared";
import type {
  DesktopHostAuthorizationDecision,
  DesktopHostAuthorizationInput,
} from "@graft/host-runtime";
import {
  HeadlessHostStore,
  type HeadlessProviderId,
} from "./headlessHostStore.js";
import { HeadlessPtyService } from "./headlessPtyService.js";
import { HeadlessRunService } from "./headlessRunService.js";
import { HeadlessWorkspace } from "./headlessWorkspace.js";

const execFileAsync = promisify(execFile);

const COMMAND_CAPABILITIES = new Map<string, GraftDesktopCapability>(
  Object.entries(GRAFT_DESKTOP_V1_HOST_COMMAND_CAPABILITIES),
);

export const HEADLESS_HOST_CAPABILITIES = [
  "projects",
  "threads",
  "runs",
  "providers",
  "files",
  "git",
  "worktrees",
  "terminals",
  "usage",
  "cursor_replay",
  "bulk_transfer",
  "diagnostics",
] as const satisfies readonly GraftDesktopCapability[];

function payloadRecord(
  value: GraftDesktopJsonValue | undefined,
): Record<string, GraftDesktopJsonValue> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("A command payload is required");
  }
  return value;
}

function asUnknownRecord(value: unknown): Record<string, unknown> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requiredString(value, "Value");
}

function isProvider(value: unknown): value is HeadlessProviderId {
  return (
    value === "openai" ||
    value === "anthropic" ||
    value === "google" ||
    value === "copilot" ||
    value === "cursor" ||
    value === "opencode" ||
    value === "pi"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function ensureGitRepository(path: string): Promise<string> {
  const canonical = await realpath(resolve(path));
  const info = await stat(canonical);
  if (!info.isDirectory()) throw new Error("Project path is not a directory");
  const result = await execFileAsync(
    "git",
    ["-C", canonical, "rev-parse", "--is-inside-work-tree"],
    {
      encoding: "utf8",
      timeout: 10_000,
      env: process.env,
    },
  );
  if (result.stdout.trim() !== "true")
    throw new Error("Project path is not a Git repository");
  return canonical;
}

function page<T>(data: T[]): {
  data: T[];
  nextCursor: null;
  backwardsCursor: null;
} {
  return { data, nextCursor: null, backwardsCursor: null };
}

export class HeadlessHostRuntime {
  private readonly store: HeadlessHostStore;
  private readonly workspace: HeadlessWorkspace;
  private readonly pty: HeadlessPtyService;
  private readonly runs: HeadlessRunService;

  constructor(
    databasePath: string,
    private readonly dataRoot: string,
    emit: (channel: string, payload: unknown) => void,
  ) {
    this.store = new HeadlessHostStore(databasePath);
    this.workspace = new HeadlessWorkspace(
      this.store,
      join(dataRoot, "worktrees"),
      emit,
    );
    this.pty = new HeadlessPtyService(this.store, emit);
    this.runs = new HeadlessRunService(this.store, this.workspace, emit);
  }

  get activity(): { activeRunCount: number; activePtyCount: number } {
    return {
      activeRunCount: this.runs.activeCount,
      activePtyCount: this.pty.activeCount,
    };
  }

  authorize(
    input: DesktopHostAuthorizationInput,
  ): DesktopHostAuthorizationDecision {
    if (input.sessionProfile !== "desktop_occupancy") {
      return { allowed: false, reason: "wrong_profile" };
    }
    const capability = COMMAND_CAPABILITIES.get(input.commandType);
    if (!capability) return { allowed: false, reason: "unsupported_command" };
    if (!input.hostCapabilities.includes(capability)) {
      return { allowed: false, reason: "host_unsupported" };
    }
    if (!input.sessionGrants.includes(capability)) {
      return { allowed: false, reason: "missing_grant" };
    }
    if (!input.clientCapabilities.includes(capability)) {
      return { allowed: false, reason: "client_unsupported" };
    }
    return { allowed: true };
  }

  async dispatch(
    command: {
      type: string;
      payload?: GraftDesktopJsonValue;
    },
    context?: { releaseTemporaryUploads(): void },
  ): Promise<unknown> {
    switch (command.type) {
      case "app/bootstrap": {
        const projects = this.store.listProjects();
        return {
          ok: true,
          projects,
          spaces: [],
          defaultProjectId: projects[0]?.id ?? null,
          desktopProjectId: null,
          scheduler: {
            queued: 0,
            active: this.runs.activeCount,
            load: 0,
            freeMemRatio: 1,
          },
          notificationOpenThread: null,
          warnings: [],
        };
      }
      case "project/list":
        return this.store.listProjects();
      case "project/connect":
        return {
          ok: false,
          error: "Enter the absolute repository path on the remote machine",
        };
      case "project/create":
        return this.createProject(payloadRecord(command.payload));
      case "project/reorder":
        return this.reorderProjects(payloadRecord(command.payload));
      case "project/rename":
        return this.renameProject(payloadRecord(command.payload));
      case "project/remove":
        return this.removeProject(payloadRecord(command.payload));
      case "project/scan-local":
        return this.scanProjects();
      case "project/browse-directory":
        return this.browseDirectory(payloadRecord(command.payload));
      case "project/create-new":
        return this.createNewProject(payloadRecord(command.payload));
      case "thread/list":
        return this.listThreads(command.payload);
      case "thread/create":
        return this.createThread(payloadRecord(command.payload));
      case "thread/update":
        return this.updateThread(payloadRecord(command.payload));
      case "thread/updateTrackedPr":
        return this.updateTrackedPr(payloadRecord(command.payload));
      case "thread/archive":
        return this.setArchived(payloadRecord(command.payload), true);
      case "thread/unarchive":
        return this.setArchived(payloadRecord(command.payload), false);
      case "thread/delete":
        return this.deleteThread(payloadRecord(command.payload));
      case "thread/events":
        return this.threadEvents(payloadRecord(command.payload));
      case "thread/events/page":
        return page(this.threadEvents(payloadRecord(command.payload)));
      case "thread/parts":
        return this.threadParts(payloadRecord(command.payload));
      case "thread/parts/page":
        return page(this.threadParts(payloadRecord(command.payload)));
      case "thread/checkpoints":
        return [];
      case "thread/checkpoints/page":
        return page([]);
      case "thread/fork":
        return this.forkThread(payloadRecord(command.payload));
      case "scheduler/stats":
        return {
          queued: 0,
          active: this.runs.activeCount,
          load: 0,
          freeMemRatio: 1,
        };
      case "turn/start":
        return this.runs.dispatch(
          command.type,
          command.payload,
          context?.releaseTemporaryUploads,
        );
      case "turn/interrupt":
      case "turn/steer":
      case "run/cancel":
      case "run/retry":
      case "session/close":
      case "session/clear-context":
        return this.runs.dispatch(command.type, command.payload);
      case "run/list":
        return this.runs.dispatch(command.type, command.payload ?? {});
      case "provider/list":
        return this.runs.listProviders();
      case "model/list":
      case "provider/cursor/models":
      case "provider/cli/models":
      case "provider/openai/models":
      case "provider/ollama/models":
        return this.runs.listModels(command.type, command.payload);
      case "usage/threadTotals":
        return {
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheCreationTokens: null,
          runsWithUsage: 0,
          totalRuns: this.store
            .listRuns()
            .filter(
              (run) =>
                run.threadId ===
                requiredString(
                  payloadRecord(command.payload).threadId,
                  "Thread ID",
                ),
            ).length,
        };
      case "files/list":
      case "files/search":
      case "files/read":
      case "files/write":
      case "files/delete":
      case "files/move":
      case "files/create-folder":
      case "files/copy":
      case "files/watch":
      case "files/unwatch":
      case "git/status":
      case "git/statusRich":
      case "git/diff":
      case "git/shortstat":
      case "git/branches":
      case "git/branchTree":
      case "git/gitWorktrees":
      case "git/stage":
      case "git/revert":
      case "git/commit":
      case "git/push":
      case "git/aheadBehind":
      case "git/checkout":
      case "git/suggestBranchName":
      case "git/createBranch":
      case "worktree/list":
      case "worktree/create":
      case "worktree/delete":
        return this.workspace.dispatch(command.type, command.payload);
      case "files/import":
        try {
          return await this.workspace.dispatch(command.type, command.payload);
        } finally {
          context?.releaseTemporaryUploads();
        }
      case "pty/create":
      case "pty/snapshot":
      case "pty/write":
      case "pty/resize":
      case "pty/clear":
      case "pty/kill":
        return this.pty.dispatch(command.type, command.payload);
      default:
        throw new Error(`Unsupported headless host command: ${command.type}`);
    }
  }

  close(): void {
    this.runs.dispose();
    this.pty.dispose();
    this.workspace.dispose();
    this.store.close();
  }

  private async createProject(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const repoPath = await ensureGitRepository(
        requiredString(payload.repoPath, "Repository path"),
      );
      const name = requiredString(payload.name, "Project name");
      return this.store.createProject({ name, repoPath });
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private reorderProjects(
    payload: Record<string, GraftDesktopJsonValue>,
  ): unknown {
    if (!Array.isArray(payload.orderedIds)) {
      return { ok: false, error: "Project order is required" };
    }
    const ids = payload.orderedIds.map((id) =>
      requiredString(id, "Project ID"),
    );
    return this.store.reorderProjects(ids)
      ? { ok: true }
      : {
          ok: false,
          error: "Project order does not match the remote project list",
        };
  }

  private renameProject(
    payload: Record<string, GraftDesktopJsonValue>,
  ): unknown {
    const projectId = requiredString(payload.projectId, "Project ID");
    const name = requiredString(payload.name, "Project name");
    return this.store.renameProject(projectId, name)
      ? { ok: true }
      : { ok: false, error: "Project not found" };
  }

  private removeProject(
    payload: Record<string, GraftDesktopJsonValue>,
  ): unknown {
    const projectId = requiredString(payload.projectId, "Project ID");
    return this.store.removeProject(projectId)
      ? { ok: true }
      : { ok: false, error: "Project not found" };
  }

  private async scanProjects(): Promise<unknown> {
    const roots = [
      homedir(),
      join(homedir(), "Projects"),
      join(homedir(), "src"),
    ];
    const managed = new Set(
      this.store.listProjects().map((project) => project.repoPath),
    );
    const folders: Array<{ name: string; path: string }> = [];
    for (const root of roots) {
      let children;
      try {
        children = await readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of children.slice(0, 500)) {
        if (!child.isDirectory() || child.name.startsWith(".")) continue;
        const path = join(root, child.name);
        try {
          const canonical = await ensureGitRepository(path);
          if (
            !managed.has(canonical) &&
            !folders.some((folder) => folder.path === canonical)
          ) {
            folders.push({ name: child.name, path: canonical });
          }
        } catch {
          // Non-repositories are expected during discovery.
        }
      }
    }
    return { ok: true, folders };
  }

  private async browseDirectory(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const requestedPath =
        payload.path === null
          ? homedir()
          : requiredString(payload.path, "Directory path");
      const logicalPath = resolve(requestedPath);
      const canonicalPath = await realpath(logicalPath);
      const directoryInfo = await stat(canonicalPath);
      if (!directoryInfo.isDirectory()) {
        throw new Error("Selected path is not a directory");
      }

      const children = await readdir(canonicalPath, { withFileTypes: true });
      const directories = [];
      for (const entry of children) {
        if (entry.isDirectory()) {
          directories.push(entry);
          continue;
        }
        if (!entry.isSymbolicLink()) continue;
        try {
          if ((await stat(join(canonicalPath, entry.name))).isDirectory()) {
            directories.push(entry);
          }
        } catch {
          // Dangling or non-directory symlink.
        }
      }
      directories.sort((left, right) =>
        left.name.localeCompare(right.name, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
      const limitedDirectories = directories.slice(0, 2_000);
      const entries = await Promise.all(
        limitedDirectories.map(async (entry) => {
          const path = join(logicalPath, entry.name);
          const isGitRepository = await stat(join(path, ".git"))
            .then(() => true)
            .catch(() => false);
          return { name: entry.name, path, isGitRepository };
        }),
      );
      const parent = resolve(logicalPath, "..");
      const isGitRepository = await stat(join(canonicalPath, ".git"))
        .then(() => true)
        .catch(() => false);

      return {
        ok: true,
        path: logicalPath,
        parentPath: parent === logicalPath ? null : parent,
        isGitRepository,
        entries,
      };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async createNewProject(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const name = requiredString(payload.name, "Project name");
      const slug =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/gu, "-")
          .replace(/^-+|-+$/gu, "") || `project-${Date.now()}`;
      const projectsRoot = join(this.dataRoot, "projects");
      await mkdir(projectsRoot, { recursive: true, mode: 0o700 });
      const path = join(projectsRoot, slug);
      await mkdir(path, { recursive: false, mode: 0o700 });
      await execFileAsync("git", ["-C", path, "init"], {
        encoding: "utf8",
        timeout: 10_000,
        env: process.env,
      });
      return {
        ok: true,
        project: this.store.createProject({ name, repoPath: path }),
      };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private listThreads(rawPayload: GraftDesktopJsonValue | undefined): unknown {
    const payload = rawPayload === undefined ? {} : payloadRecord(rawPayload);
    return this.store.listThreads({
      ...(typeof payload.projectId === "string"
        ? { projectId: payload.projectId }
        : {}),
      archived: payload.archived === true,
    });
  }

  private async createThread(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const projectId = requiredString(payload.projectId, "Project ID");
      const project = this.store.getProject(projectId);
      if (!project) throw new Error("Project not found");
      const mode = payload.mode === "worktree" ? "worktree" : "local";
      let worktreeId: string | null = null;
      let localPath = project.repoPath;
      if (mode === "worktree") {
        if (typeof payload.worktreeId === "string") {
          const worktree = this.store.getWorktree(
            projectId,
            payload.worktreeId,
          );
          if (!worktree || worktree.status !== "active")
            throw new Error("Worktree not found");
          worktreeId = worktree.id;
          localPath = worktree.path;
        } else {
          const created = await this.workspace.dispatch("worktree/create", {
            projectId,
          });
          const createdRecord = asUnknownRecord(created);
          if (!createdRecord || "ok" in createdRecord) {
            throw new Error(
              createdRecord && typeof createdRecord.error === "string"
                ? createdRecord.error
                : "Worktree could not be created",
            );
          }
          worktreeId = requiredString(createdRecord.id, "Worktree ID");
          localPath = requiredString(createdRecord.path, "Worktree path");
        }
      }
      if (typeof payload.localPath === "string") {
        this.workspace.resolveWorkspace({
          projectId,
          ...(worktreeId ? { worktreeId } : {}),
          localPath: payload.localPath,
        });
        localPath = payload.localPath;
      }
      const provider = isProvider(payload.providerHint)
        ? payload.providerHint
        : "openai";
      return this.store.createThread({
        projectId,
        title:
          typeof payload.title === "string" && payload.title.trim()
            ? payload.title.trim()
            : "New Thread",
        mode,
        worktreeId,
        localPath,
        providerHint: provider,
        modelName:
          typeof payload.modelName === "string" && payload.modelName.trim()
            ? payload.modelName.trim()
            : null,
      });
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private updateThread(
    payload: Record<string, GraftDesktopJsonValue>,
  ): unknown {
    try {
      const threadId = requiredString(payload.threadId, "Thread ID");
      const thread = this.store.getThread(threadId);
      if (!thread) throw new Error("Thread not found");
      const updates: Parameters<HeadlessHostStore["updateThread"]>[1] = {};
      if (typeof payload.title === "string")
        updates.title = requiredString(payload.title, "Title");
      if (payload.mode === "local" || payload.mode === "worktree")
        updates.mode = payload.mode;
      const worktreeId = optionalString(payload.worktreeId);
      if (worktreeId !== undefined) updates.worktreeId = worktreeId;
      const localPath = optionalString(payload.localPath);
      if (localPath !== undefined) updates.localPath = localPath;
      const trackedBranch = optionalString(payload.trackedBranch);
      if (trackedBranch !== undefined) updates.trackedBranch = trackedBranch;
      const modelName = optionalString(payload.modelName);
      if (modelName !== undefined) updates.modelName = modelName;
      const approvalPolicy = optionalString(payload.approvalPolicy);
      if (approvalPolicy !== undefined) updates.approvalPolicy = approvalPolicy;
      const cliSessionId = optionalString(payload.cliSessionId);
      if (cliSessionId !== undefined) updates.cliSessionId = cliSessionId;
      if (payload.providerHint === null || isProvider(payload.providerHint)) {
        updates.providerHint = payload.providerHint;
      }
      if (payload.executionMode === null || payload.executionMode === "byom") {
        updates.executionMode = payload.executionMode;
      }
      if (updates.worktreeId || updates.localPath) {
        this.workspace.resolveWorkspace({
          projectId: thread.projectId,
          ...(updates.worktreeId ? { worktreeId: updates.worktreeId } : {}),
          ...(updates.localPath ? { localPath: updates.localPath } : {}),
        });
      }
      return this.store.updateThread(threadId, updates)
        ? { ok: true }
        : { ok: false, error: "Thread not found" };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private updateTrackedPr(
    payload: Record<string, GraftDesktopJsonValue>,
  ): unknown {
    const threadId = requiredString(payload.threadId, "Thread ID");
    return this.store.updateThread(threadId, {
      trackedPrUrl: optionalString(payload.prUrl) ?? null,
      trackedPrNumber:
        typeof payload.prNumber === "number" ? payload.prNumber : null,
    })
      ? { ok: true }
      : { ok: false, error: "Thread not found" };
  }

  private setArchived(
    payload: Record<string, GraftDesktopJsonValue>,
    archived: boolean,
  ): unknown {
    const threadId = requiredString(payload.threadId, "Thread ID");
    return this.store.updateThread(threadId, {
      archivedAt: archived ? Date.now() : null,
    })
      ? { ok: true }
      : { ok: false, error: "Thread not found" };
  }

  private deleteThread(
    payload: Record<string, GraftDesktopJsonValue>,
  ): unknown {
    const threadId = requiredString(payload.threadId, "Thread ID");
    return this.store.deleteThread(threadId)
      ? { ok: true }
      : { ok: false, error: "Thread not found" };
  }

  private threadEvents(payload: Record<string, GraftDesktopJsonValue>) {
    const limit = Math.min(Math.max(Number(payload.limit ?? 200), 1), 500);
    return this.store.listEvents(
      requiredString(payload.threadId, "Thread ID"),
      limit,
    );
  }

  private threadParts(payload: Record<string, GraftDesktopJsonValue>) {
    const limit = Math.min(Math.max(Number(payload.limit ?? 500), 1), 500);
    return this.store.listParts(
      requiredString(payload.threadId, "Thread ID"),
      limit,
    );
  }

  private forkThread(payload: Record<string, GraftDesktopJsonValue>): unknown {
    const sourceId = requiredString(payload.threadId, "Thread ID");
    const fork = this.store.forkThread(sourceId);
    return fork
      ? { ok: true, threadId: fork.id }
      : { ok: false, error: "Thread not found" };
  }
}
