import { execFile } from "node:child_process";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { existsSync, realpathSync, watch, type FSWatcher } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";
import type { GraftDesktopJsonValue } from "@graft/shared";
import {
  HeadlessHostStore,
  type HeadlessProjectRow,
  type HeadlessWorktreeRow,
} from "./headlessHostStore.js";

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_READ_BYTES = 150 * 1024;
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "coverage",
  "target",
]);

interface ProjectFileNode {
  type: "file" | "directory";
  name: string;
  relativePath: string;
  children?: ProjectFileNode[];
}

interface RepositoryPayload {
  projectId: string;
  worktreeId?: string;
  localPath?: string;
}

interface GitExecutionResult {
  stdout: string;
  stderr: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function requireRelativePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 16_384 ||
    value.includes("\0") ||
    isAbsolute(value) ||
    value.split(/[\\/]/u).some((segment) => !segment || segment === "..")
  ) {
    throw new Error("A safe project-relative path is required");
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function parsePayload(
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

function imageMediaType(path: string): string | null {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    default:
      return null;
  }
}

function parseNumstat(output: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of output.trim().split("\n")) {
    if (!line) continue;
    const [added, removed] = line.split("\t");
    if (added !== "-" && Number.isFinite(Number(added)))
      additions += Number(added);
    if (removed !== "-" && Number.isFinite(Number(removed)))
      deletions += Number(removed);
  }
  return { additions, deletions };
}

function statusLabel(indexStatus: string, worktreeStatus: string): string {
  const status = `${indexStatus}${worktreeStatus}`;
  if (status === "??") return "untracked";
  if (status.includes("A")) return "added";
  if (status.includes("D")) return "deleted";
  if (status.includes("R")) return "renamed";
  if (status.includes("U")) return "conflicted";
  return "modified";
}

function safeBranchName(value: unknown): string {
  const branch = requireString(value, "Branch").trim();
  if (
    branch.startsWith("-") ||
    branch.includes("..") ||
    /[~^:?*[\\\s]/u.test(branch) ||
    branch.endsWith(".") ||
    branch.endsWith("/") ||
    branch.includes("//")
  ) {
    throw new Error("The branch name is invalid");
  }
  return branch;
}

function insertTreeNode(root: ProjectFileNode[], relativePath: string): void {
  const segments = relativePath.split("/").filter(Boolean);
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    const name = segments[index];
    if (!name) continue;
    const path = segments.slice(0, index + 1).join("/");
    const isFile = index === segments.length - 1;
    let node = current.find((candidate) => candidate.name === name);
    if (!node) {
      node = isFile
        ? { type: "file", name, relativePath: path }
        : { type: "directory", name, relativePath: path, children: [] };
      current.push(node);
    }
    if (!isFile) {
      node.children ??= [];
      current = node.children;
    }
  }
}

function sortTree(nodes: ProjectFileNode[]): void {
  nodes.sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) {
    if (node.children) sortTree(node.children);
  }
}

export class HeadlessWorkspace {
  private watcher: FSWatcher | null = null;
  private watchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingWatchPaths = new Set<string>();

  constructor(
    private readonly store: HeadlessHostStore,
    private readonly worktreeRoot: string,
    private readonly emit: (channel: string, payload: unknown) => void,
  ) {}

  async dispatch(
    type: string,
    rawPayload: GraftDesktopJsonValue | undefined,
  ): Promise<unknown> {
    switch (type) {
      case "files/list":
        return this.listFiles(parsePayload(rawPayload));
      case "files/search":
        return this.searchFiles(parsePayload(rawPayload));
      case "files/read":
        return this.readFile(parsePayload(rawPayload));
      case "files/write":
        return this.writeFile(parsePayload(rawPayload));
      case "files/import":
        return this.importFiles(parsePayload(rawPayload));
      case "files/delete":
        return this.deletePath(parsePayload(rawPayload));
      case "files/move":
        return this.movePath(parsePayload(rawPayload));
      case "files/create-folder":
        return this.createFolder(parsePayload(rawPayload));
      case "files/copy":
        return this.copyPath(parsePayload(rawPayload));
      case "files/watch":
        return this.watchFiles(parsePayload(rawPayload));
      case "files/unwatch":
        this.unwatchFiles();
        return { ok: true };
      case "git/status":
        return this.gitStatus(parsePayload(rawPayload));
      case "git/statusRich":
        return this.gitStatusRich(parsePayload(rawPayload));
      case "git/diff":
        return this.gitDiff(parsePayload(rawPayload));
      case "git/shortstat":
        return this.gitShortstat(parsePayload(rawPayload));
      case "git/branches":
        return this.gitBranches(parsePayload(rawPayload));
      case "git/branchTree":
        return this.gitBranchTree(parsePayload(rawPayload));
      case "git/gitWorktrees":
        return this.gitWorktrees(parsePayload(rawPayload));
      case "git/stage":
        return this.gitStage(parsePayload(rawPayload));
      case "git/revert":
        return this.gitRevert(parsePayload(rawPayload));
      case "git/commit":
        return this.gitCommit(parsePayload(rawPayload));
      case "git/push":
        return this.gitPush(parsePayload(rawPayload));
      case "git/aheadBehind":
        return this.gitAheadBehind(parsePayload(rawPayload));
      case "git/checkout":
        return this.gitCheckout(parsePayload(rawPayload));
      case "git/suggestBranchName":
        return this.gitSuggestBranchName(parsePayload(rawPayload));
      case "git/createBranch":
        return this.gitCreateBranch(parsePayload(rawPayload));
      case "worktree/list":
        return this.store.listWorktrees(
          requireString(parsePayload(rawPayload).projectId, "Project ID"),
        );
      case "worktree/create":
        return this.createWorktree(parsePayload(rawPayload));
      case "worktree/delete":
        return this.deleteWorktree(parsePayload(rawPayload));
      default:
        throw new Error(`Unsupported workspace command: ${type}`);
    }
  }

  dispose(): void {
    this.unwatchFiles();
  }

  resolveWorkspace(payload: RepositoryPayload): {
    project: HeadlessProjectRow;
    worktree: HeadlessWorktreeRow | null;
    root: string;
  } {
    const project = this.store.getProject(payload.projectId);
    if (!project) throw new Error("Project not found");
    const worktree = payload.worktreeId
      ? this.store.getWorktree(project.id, payload.worktreeId)
      : null;
    if (payload.worktreeId && (!worktree || worktree.status !== "active")) {
      throw new Error("Worktree not found");
    }
    const configuredRoot = worktree?.path ?? project.repoPath;
    const root = realpathSync(configuredRoot);
    if (payload.localPath) {
      const requested = realpathSync(resolve(payload.localPath));
      if (requested !== root) {
        throw new Error("The requested path is not owned by this project");
      }
    }
    return { project, worktree, root };
  }

  private repositoryPayload(
    payload: Record<string, GraftDesktopJsonValue>,
  ): RepositoryPayload {
    return {
      projectId: requireString(payload.projectId, "Project ID"),
      ...(typeof payload.worktreeId === "string"
        ? { worktreeId: payload.worktreeId }
        : {}),
      ...(typeof payload.localPath === "string"
        ? { localPath: payload.localPath }
        : {}),
    };
  }

  private safeTarget(
    root: string,
    rawRelativePath: unknown,
    mustExist: boolean,
  ): string {
    const relativePath = requireRelativePath(rawRelativePath);
    const lexicalTarget = resolve(root, relativePath);
    if (!isWithin(root, lexicalTarget) || lexicalTarget === root) {
      throw new Error("The path is outside the project");
    }
    if (mustExist && !existsSync(lexicalTarget))
      throw new Error("Path not found");
    let ancestor = lexicalTarget;
    while (!existsSync(ancestor)) {
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error("Path not found");
      ancestor = parent;
    }
    const realAncestor = realpathSync(ancestor);
    if (!isWithin(root, realAncestor)) {
      throw new Error("The path escapes the project through a symbolic link");
    }
    if (existsSync(lexicalTarget)) {
      const realTarget = realpathSync(lexicalTarget);
      if (!isWithin(root, realTarget) || realTarget === root) {
        throw new Error("The path is outside the project");
      }
      return realTarget;
    }
    return lexicalTarget;
  }

  private async listFiles(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
      const entries: ProjectFileNode[] = [];
      try {
        const { stdout } = await this.git(root, [
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
        ]);
        for (const path of stdout.split("\0")) {
          if (path) insertTreeNode(entries, path);
        }
      } catch {
        await this.walkTree(
          root,
          root,
          entries,
          0,
          Number(payload.maxDepth ?? 20),
        );
      }
      sortTree(entries);
      return { ok: true, rootPath: root, entries };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async walkTree(
    root: string,
    directory: string,
    output: ProjectFileNode[],
    depth: number,
    maxDepth: number,
  ): Promise<void> {
    if (depth >= maxDepth) return;
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      if (
        child.name.includes("\0") ||
        (child.isDirectory() && SKIPPED_DIRECTORIES.has(child.name))
      ) {
        continue;
      }
      const absolute = join(directory, child.name);
      const path = relative(root, absolute).split(sep).join("/");
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) {
        const node: ProjectFileNode = {
          type: "directory",
          name: child.name,
          relativePath: path,
          children: [],
        };
        output.push(node);
        await this.walkTree(
          root,
          absolute,
          node.children ?? [],
          depth + 1,
          maxDepth,
        );
      } else if (child.isFile()) {
        output.push({ type: "file", name: child.name, relativePath: path });
      }
    }
  }

  private async searchFiles(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    const listed = await this.listFiles(payload);
    const listedRecord = asUnknownRecord(listed);
    if (
      !listedRecord ||
      listedRecord.ok !== true ||
      !Array.isArray(listedRecord.entries)
    ) {
      return listed;
    }
    const query =
      typeof payload.query === "string" ? payload.query.toLowerCase() : "";
    const limit = Math.min(Math.max(Number(payload.limit ?? 100), 1), 500);
    const matches: Array<{ type: "file" | "directory"; relativePath: string }> =
      [];
    const visit = (nodes: ProjectFileNode[]) => {
      for (const node of nodes) {
        if (node.relativePath.toLowerCase().includes(query)) {
          matches.push({ type: node.type, relativePath: node.relativePath });
        }
        if (matches.length >= limit) return;
        if (node.children) visit(node.children);
        if (matches.length >= limit) return;
      }
    };
    visit(listedRecord.entries as ProjectFileNode[]);
    return {
      ok: true,
      rootPath: requireString(listedRecord.rootPath, "Workspace root"),
      entries: matches,
      truncated: matches.length >= limit,
    };
  }

  private async readFile(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
      const path = this.safeTarget(root, payload.relativePath, true);
      const info = await stat(path);
      if (!info.isFile()) throw new Error("Path is not a file");
      const maxBytes = Math.min(
        Math.max(Number(payload.maxBytes ?? DEFAULT_READ_BYTES), 1),
        MAX_FILE_BYTES,
      );
      const bytes = await readFile(path);
      const truncated = bytes.length > maxBytes;
      const visible = bytes.subarray(0, maxBytes);
      const mediaType = imageMediaType(path);
      if (mediaType) {
        const content = `data:${mediaType};base64,${visible.toString("base64")}`;
        return {
          ok: true,
          path,
          content,
          truncated,
          image: true,
          ...(mediaType === "image/svg+xml"
            ? { svgSource: visible.toString("utf8") }
            : {}),
          mtimeMs: info.mtimeMs,
        };
      }
      const binary = visible.includes(0);
      return {
        ok: true,
        path,
        content: binary ? "" : visible.toString("utf8"),
        truncated,
        binary,
        mtimeMs: info.mtimeMs,
      };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async writeFile(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
      const path = this.safeTarget(root, payload.relativePath, false);
      if (typeof payload.content !== "string")
        throw new Error("File content is required");
      const content = payload.content;
      if (Buffer.byteLength(content) > MAX_FILE_BYTES)
        throw new Error("File content is too large");
      if (
        existsSync(path) &&
        typeof payload.expectedMtimeMs === "number" &&
        payload.overwrite !== true
      ) {
        const current = await stat(path);
        if (Math.abs(current.mtimeMs - payload.expectedMtimeMs) > 0.5) {
          return {
            ok: false,
            code: "conflict",
            mtimeMs: current.mtimeMs,
            error: "The file changed on the host",
          };
        }
      }
      await mkdir(dirname(path), { recursive: true });
      const temporary = join(
        dirname(path),
        `.${basename(path)}.${randomUUID()}.tmp`,
      );
      await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, path);
      const info = await stat(path);
      return { ok: true, path, mtimeMs: info.mtimeMs };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async importFiles(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
      if (
        !Array.isArray(payload.sourcePaths) ||
        payload.sourcePaths.length === 0
      ) {
        throw new Error("Imported files are required");
      }
      const targetDirectory =
        typeof payload.targetDir === "string" && payload.targetDir.length > 0
          ? requireRelativePath(payload.targetDir)
          : null;
      const imported: string[] = [];
      for (const rawSourcePath of payload.sourcePaths) {
        const sourcePath = requireString(rawSourcePath, "Imported file");
        const sourceInfo = await lstat(sourcePath);
        if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
          throw new Error("Imported source must be a regular file");
        }
        const fileName = basename(sourcePath);
        const relativePath = targetDirectory
          ? `${targetDirectory}/${fileName}`
          : fileName;
        const destination = this.safeTarget(root, relativePath, false);
        if (existsSync(destination)) {
          throw new Error(`A file already exists at ${relativePath}`);
        }
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        await copyFile(sourcePath, destination);
        imported.push(relativePath);
      }
      return { ok: true, imported };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async deletePath(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
      const path = this.safeTarget(root, payload.relativePath, true);
      await rm(path, { recursive: true, force: false });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async movePath(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
      const from = this.safeTarget(root, payload.fromPath, true);
      const to = this.safeTarget(root, payload.toPath, false);
      if (existsSync(to)) throw new Error("Destination already exists");
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async createFolder(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
      const path = this.safeTarget(root, payload.relativePath, false);
      await mkdir(path, { recursive: false });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async copyPath(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
      const from = this.safeTarget(root, payload.fromPath, true);
      const requested = this.safeTarget(root, payload.toPath, false);
      let destination = requested;
      let suffix = 2;
      while (existsSync(destination)) {
        const extension = extname(requested);
        destination = join(
          dirname(requested),
          `${basename(requested, extension)} ${suffix}${extension}`,
        );
        suffix += 1;
      }
      const info = await lstat(from);
      await mkdir(dirname(destination), { recursive: true });
      if (info.isDirectory())
        await cp(from, destination, { recursive: true, errorOnExist: true });
      else await copyFile(from, destination);
      return {
        ok: true,
        newPath: relative(root, destination).split(sep).join("/"),
      };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async watchFiles(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      this.unwatchFiles();
      const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
      this.watcher = watch(
        root,
        { recursive: true },
        (_eventType, filename) => {
          if (!filename) return;
          const path = filename.toString().split(sep).join("/");
          if (!path || path.split("/").some((part) => part === ".git")) return;
          this.pendingWatchPaths.add(path);
          if (this.watchTimer) return;
          this.watchTimer = setTimeout(() => {
            this.watchTimer = null;
            const events = [...this.pendingWatchPaths].map((relativePath) => ({
              relativePath,
              kind: existsSync(resolve(root, relativePath))
                ? "changed"
                : "deleted",
            }));
            this.pendingWatchPaths.clear();
            this.emit("codex_desktop:file-watch-events", {
              rootPath: root,
              events,
            });
          }, 100);
        },
      );
      return { ok: true, rootPath: root };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private unwatchFiles(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = null;
    this.pendingWatchPaths.clear();
  }

  private async gitStatus(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
      const { stdout } = await this.git(root, [
        "status",
        "--porcelain=v1",
        "-b",
      ]);
      const [branchSummary = "", ...entries] = stdout.trimEnd().split("\n");
      return { branchSummary, entries: entries.filter(Boolean) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async gitStatusRich(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    const { project, worktree, root } = this.resolveWorkspace(
      this.repositoryPayload(payload),
    );
    const { stdout } = await this.git(root, ["status", "--porcelain=v1", "-b"]);
    const [branchSummary = "", ...entries] = stdout.trimEnd().split("\n");
    const branchName = (
      await this.git(root, ["branch", "--show-current"]).catch(() => ({
        stdout: "",
        stderr: "",
      }))
    ).stdout.trim();
    const defaultBranch = await this.defaultBranch(root);
    const upstreamName = (
      await this.git(root, ["rev-parse", "--abbrev-ref", "@{upstream}"]).catch(
        () => ({ stdout: "", stderr: "" }),
      )
    ).stdout.trim();
    const counts = upstreamName
      ? await this.git(root, [
          "rev-list",
          "--left-right",
          "--count",
          `${upstreamName}...HEAD`,
        ])
          .then(({ stdout: value }) => value.trim().split(/\s+/u).map(Number))
          .catch(() => [0, 0])
      : [0, 0];
    const changedFiles = entries.filter(Boolean).map((entry) => {
      const indexStatus = entry[0] ?? " ";
      const worktreeStatus = entry[1] ?? " ";
      const rawPath = entry.slice(3);
      const renameParts = rawPath.split(" -> ");
      const path = renameParts.at(-1) ?? rawPath;
      return {
        path,
        ...(renameParts.length > 1 ? { previousPath: renameParts[0] } : {}),
        indexStatus,
        worktreeStatus,
        statusLabel: statusLabel(indexStatus, worktreeStatus),
        staged: indexStatus !== " " && indexStatus !== "?",
        unstaged: worktreeStatus !== " ",
        untracked: indexStatus === "?" && worktreeStatus === "?",
      };
    });
    const normal = await this.git(root, ["diff", "--numstat"]).then(
      ({ stdout: value }) => parseNumstat(value),
    );
    const staged = await this.git(root, ["diff", "--cached", "--numstat"]).then(
      ({ stdout: value }) => parseNumstat(value),
    );
    const ahead = counts[1] ?? 0;
    const behind = counts[0] ?? 0;
    return {
      branch: {
        name: branchName,
        isCurrent: true,
        isDefault: branchName === defaultBranch,
        defaultBranch,
        detached: branchName.length === 0,
        upstream: upstreamName || null,
        ahead,
        behind,
      },
      workingTree: {
        branchSummary,
        statusText: stdout.trimEnd(),
        hasChanges: changedFiles.length > 0,
        stagedChanges: changedFiles.some((file) => file.staged),
        unstagedChanges: changedFiles.some(
          (file) => file.unstaged || file.untracked,
        ),
        changedFiles,
        additions: normal.additions + staged.additions,
        deletions: normal.deletions + staged.deletions,
      },
      upstream: {
        exists: Boolean(upstreamName),
        name: upstreamName || null,
        ahead,
        behind,
        lastFetchedAt: null,
        refreshed: false,
      },
      worktree: worktree
        ? { path: root, branch: branchName || null, isMain: false }
        : root !== project.repoPath
          ? { path: root, branch: branchName || null, isMain: false }
          : null,
      pullRequest: {
        exists: false,
        url: null,
        state: null,
        number: null,
        title: null,
        lookupSucceeded: false,
      },
    };
  }

  private async gitDiff(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<string> {
    const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
    const args = ["diff", "--no-ext-diff", "--"];
    if (payload.staged === true) args.splice(1, 0, "--cached");
    return (await this.git(root, args)).stdout;
  }

  private async gitShortstat(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
    const normal = await this.git(root, ["diff", "--numstat"]).then(
      ({ stdout }) => parseNumstat(stdout),
    );
    const staged = await this.git(root, ["diff", "--cached", "--numstat"]).then(
      ({ stdout }) => parseNumstat(stdout),
    );
    return {
      additions: normal.additions + staged.additions,
      deletions: normal.deletions + staged.deletions,
    };
  }

  private async gitBranches(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    const projectId = requireString(payload.projectId, "Project ID");
    const project = this.store.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const { stdout } = await this.git(project.repoPath, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
    ]);
    return stdout
      .split("\n")
      .map((branch) => branch.trim())
      .filter(Boolean);
  }

  private async gitBranchTree(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
    const current = (
      await this.git(root, ["branch", "--show-current"])
    ).stdout.trim();
    const defaultBranch = await this.defaultBranch(root);
    const { stdout } = await this.git(root, [
      "for-each-ref",
      "--format=%(refname:short)%00%(committerdate:iso-strict)%00%(subject)",
      "refs/heads",
    ]);
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [
          name = "",
          lastCommitDate = new Date(0).toISOString(),
          lastCommitMessage = "",
        ] = line.split("\0");
        return {
          name,
          parentBranch: name === defaultBranch ? null : defaultBranch,
          isCurrent: name === current,
          ahead: 0,
          behind: 0,
          lastCommitDate,
          lastCommitMessage,
        };
      });
  }

  private async gitWorktrees(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    const projectId = requireString(payload.projectId, "Project ID");
    const project = this.store.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const { stdout } = await this.git(project.repoPath, [
      "worktree",
      "list",
      "--porcelain",
    ]);
    const records = stdout.trim().split("\n\n").filter(Boolean);
    return records.map((record) => {
      const lines = record.split("\n");
      const path =
        lines.find((line) => line.startsWith("worktree "))?.slice(9) ??
        project.repoPath;
      const branchRef =
        lines.find((line) => line.startsWith("branch "))?.slice(7) ?? "";
      return {
        path,
        branch: branchRef.replace(/^refs\/heads\//u, "") || "HEAD",
        isMain: realpathSync(path) === realpathSync(project.repoPath),
      };
    });
  }

  private async gitStage(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
      const files = this.gitFileList(payload.files);
      await this.git(
        root,
        files.length > 0 ? ["add", "--", ...files] : ["add", "-A", "--"],
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async gitRevert(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
      const files = this.gitFileList(payload.files);
      if (files.length === 0)
        throw new Error("Select at least one file to revert");
      await this.git(root, [
        "restore",
        "--staged",
        "--worktree",
        "--",
        ...files,
      ]);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async gitCommit(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
      const message = requireString(payload.message, "Commit message");
      const files = this.gitFileList(payload.selectedFiles);
      if (files.length === 0)
        throw new Error("Select at least one file to commit");
      await this.git(root, ["add", "--", ...files]);
      await this.git(root, ["commit", "-m", message, "--", ...files]);
      const commitSha = (
        await this.git(root, ["rev-parse", "HEAD"])
      ).stdout.trim();
      const branch = (
        await this.git(root, ["branch", "--show-current"])
      ).stdout.trim();
      return {
        ok: true,
        commitSha,
        pushAuthorization: branch
          ? { oid: commitSha, headRef: `refs/heads/${branch}` }
          : null,
      };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async gitPush(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
      const branch = (
        await this.git(root, ["branch", "--show-current"])
      ).stdout.trim();
      if (!branch) throw new Error("Cannot push a detached HEAD");
      const result = await this.git(root, [
        "push",
        "--set-upstream",
        "origin",
        branch,
      ]);
      return { ok: true, output: `${result.stdout}${result.stderr}`.trim() };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async gitAheadBehind(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
    const { stdout } = await this.git(root, [
      "rev-list",
      "--left-right",
      "--count",
      "@{upstream}...HEAD",
    ]);
    const [behind = 0, ahead = 0] = stdout.trim().split(/\s+/u).map(Number);
    return { ok: true, ahead, behind };
  }

  private async gitCheckout(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
      await this.git(root, ["checkout", safeBranchName(payload.branch)]);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private gitSuggestBranchName(
    payload: Record<string, GraftDesktopJsonValue>,
  ): unknown {
    const hint = requireString(payload.hint, "Branch hint")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 64);
    return { ok: true, branch: hint || `graft-${Date.now()}` };
  }

  private async gitCreateBranch(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const { root } = this.resolveWorkspace(this.repositoryPayload(payload));
      const branch = safeBranchName(payload.branch);
      await this.git(root, ["checkout", "-b", branch]);
      return { ok: true, branch };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async createWorktree(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const projectId = requireString(payload.projectId, "Project ID");
      const project = this.store.getProject(projectId);
      if (!project) throw new Error("Project not found");
      const baseBranch =
        typeof payload.baseBranch === "string" && payload.baseBranch.trim()
          ? safeBranchName(payload.baseBranch)
          : (
              await this.git(project.repoPath, ["branch", "--show-current"])
            ).stdout.trim() || "HEAD";
      const id = randomUUID();
      const branchName = `graft/${id.slice(0, 8)}`;
      const path = join(this.worktreeRoot, project.id, id);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await this.git(project.repoPath, [
        "worktree",
        "add",
        "-b",
        branchName,
        path,
        baseBranch,
      ]);
      return this.store.createWorktree({
        projectId,
        path,
        branchName,
        baseBranch,
      });
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async deleteWorktree(
    payload: Record<string, GraftDesktopJsonValue>,
  ): Promise<unknown> {
    try {
      const projectId = requireString(payload.projectId, "Project ID");
      const worktreeId = requireString(payload.worktreeId, "Worktree ID");
      const project = this.store.getProject(projectId);
      const worktree = this.store.getWorktree(projectId, worktreeId);
      if (!project || !worktree || worktree.status !== "active")
        throw new Error("Project or worktree not found");
      await this.git(project.repoPath, [
        "worktree",
        "remove",
        "--force",
        worktree.path,
      ]);
      await this.git(project.repoPath, ["worktree", "prune"]);
      this.store.markWorktreeDeleted(worktree.id);
      return { ok: true, worktreeId };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private gitFileList(value: GraftDesktopJsonValue | undefined): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error("Files must be an array");
    return value.map(requireRelativePath);
  }

  private async defaultBranch(root: string): Promise<string | null> {
    const remote = await this.git(root, [
      "symbolic-ref",
      "--quiet",
      "--short",
      "refs/remotes/origin/HEAD",
    ])
      .then(({ stdout }) => stdout.trim().replace(/^origin\//u, ""))
      .catch(() => "");
    if (remote) return remote;
    const branches: string[] = await this.git(root, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
    ])
      .then(({ stdout }) => stdout.split("\n").filter(Boolean))
      .catch((): string[] => []);
    if (branches.includes("main")) return "main";
    if (branches.includes("master")) return "master";
    return branches[0] ?? null;
  }

  private async git(root: string, args: string[]): Promise<GitExecutionResult> {
    const result = await execFileAsync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60_000,
      env: process.env,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  }
}
