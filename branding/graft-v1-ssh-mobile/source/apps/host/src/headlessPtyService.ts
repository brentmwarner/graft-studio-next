import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { spawn, type IPty } from "node-pty";
import { deriveTerminalScope, type GraftDesktopJsonValue } from "@graft/shared";
import type { HeadlessHostStore } from "./headlessHostStore.js";

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;
const HISTORY_LIMIT = 256 * 1024;

interface ManagedPty {
  id: string;
  process: IPty;
  cwd: string;
  threadId: string;
  terminalId: string;
  history: string;
  status: "running" | "exited" | "error";
  exitCode: number | null;
  exitSignal: number | null;
  updatedAt: string;
  sequence: number;
  cols: number;
  rows: number;
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function requirePayload(
  value: GraftDesktopJsonValue | undefined,
): Record<string, GraftDesktopJsonValue> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("A terminal payload is required");
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error(`${label} is required`);
  }
  return value;
}

export class HeadlessPtyService {
  private readonly sessions = new Map<string, ManagedPty>();

  constructor(
    private readonly store: HeadlessHostStore,
    private readonly emit: (channel: string, payload: unknown) => void,
  ) {}

  get activeCount(): number {
    return this.sessions.size;
  }

  dispatch(
    type: string,
    rawPayload: GraftDesktopJsonValue | undefined,
  ): unknown {
    const payload = requirePayload(rawPayload);
    const id = requireString(payload.id, "Terminal ID");
    switch (type) {
      case "pty/create":
        return this.create(id, requireString(payload.cwd, "Working directory"));
      case "pty/snapshot":
        return {
          ok: true,
          snapshot: this.snapshot(this.sessions.get(id) ?? null),
        };
      case "pty/write": {
        const session = this.sessions.get(id);
        if (!session) return { ok: false, error: "Terminal session not found" };
        session.process.write(requireString(payload.data, "Terminal input"));
        return { ok: true };
      }
      case "pty/resize": {
        const session = this.sessions.get(id);
        const cols = Number(payload.cols);
        const rows = Number(payload.rows);
        if (
          !Number.isInteger(cols) ||
          cols <= 0 ||
          !Number.isInteger(rows) ||
          rows <= 0
        ) {
          throw new Error("Terminal dimensions must be positive integers");
        }
        if (session) {
          session.cols = cols;
          session.rows = rows;
          session.process.resize(cols, rows);
        }
        return { ok: true };
      }
      case "pty/clear": {
        const session = this.sessions.get(id);
        if (session) {
          session.history = "";
          this.emitEvent(session, { type: "cleared" });
        }
        return { ok: true };
      }
      case "pty/kill":
        this.kill(id);
        return { ok: true };
      default:
        throw new Error(`Unsupported PTY command: ${type}`);
    }
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }

  private create(id: string, requestedCwd: string): unknown {
    const cwd = this.authorizeCwd(requestedCwd);
    const existing = this.sessions.get(id);
    if (existing?.cwd === cwd) {
      return { ok: true, created: false, reused: true, restarted: false };
    }
    if (existing) this.kill(id);
    const { threadId, terminalId } = deriveTerminalScope(id);
    const shell = process.env.SHELL || "/bin/bash";
    let terminal: IPty;
    try {
      terminal = spawn(shell, ["-l"], {
        name: "xterm-256color",
        cwd,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        env: process.env as Record<string, string>,
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const session: ManagedPty = {
      id,
      process: terminal,
      cwd,
      threadId,
      terminalId,
      history: "",
      status: "running",
      exitCode: null,
      exitSignal: null,
      updatedAt: new Date().toISOString(),
      sequence: 0,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    };
    this.sessions.set(id, session);
    terminal.onData((data) => {
      session.history = `${session.history}${data}`.slice(-HISTORY_LIMIT);
      this.emitEvent(session, { type: "output", data });
    });
    terminal.onExit(({ exitCode, signal }) => {
      const current = this.sessions.get(id);
      if (current !== session) return;
      session.status = "exited";
      session.exitCode = exitCode;
      session.exitSignal = signal ?? null;
      this.emitEvent(session, {
        type: "exited",
        exitCode,
        exitSignal: signal ?? null,
      });
      this.emit("codex_desktop:worker:terminal:for-view", {
        type: "pty.exit",
        payload: { id, exitCode },
      });
      this.sessions.delete(id);
    });
    this.emitEvent(session, {
      type: existing ? "restarted" : "started",
      snapshot: this.snapshot(session),
    });
    return {
      ok: true,
      created: true,
      reused: false,
      restarted: existing !== undefined,
    };
  }

  private kill(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    try {
      session.process.kill();
    } catch {
      // The shell may already have exited.
    }
  }

  private authorizeCwd(input: string): string {
    let candidate: string;
    try {
      candidate = realpathSync(resolve(input || homedir()));
    } catch {
      throw new Error("Terminal working directory does not exist");
    }
    const ownedRoots = [
      ...this.store.listProjects().map((project) => project.repoPath),
      ...this.store
        .listProjects()
        .flatMap((project) =>
          this.store.listWorktrees(project.id).map((worktree) => worktree.path),
        ),
    ];
    if (
      !ownedRoots.some((root) => {
        try {
          return isWithin(realpathSync(root), candidate);
        } catch {
          return false;
        }
      })
    ) {
      throw new Error("Terminal path is not owned by a managed project");
    }
    return candidate;
  }

  private snapshot(session: ManagedPty | null): unknown {
    if (!session) return null;
    return {
      threadId: session.threadId,
      terminalId: session.terminalId,
      cwd: session.cwd,
      worktreePath: null,
      status: session.status,
      pid: session.process.pid ?? null,
      history: session.history,
      exitCode: session.exitCode,
      exitSignal: session.exitSignal,
      updatedAt: session.updatedAt,
      sequence: session.sequence,
      cols: session.cols,
      rows: session.rows,
    };
  }

  private emitEvent(session: ManagedPty, event: Record<string, unknown>): void {
    session.sequence += 1;
    session.updatedAt = new Date().toISOString();
    this.emit("codex_desktop:worker:terminal:for-view", {
      type: "terminal.event",
      payload: {
        id: session.id,
        event: {
          ...event,
          threadId: session.threadId,
          terminalId: session.terminalId,
          createdAt: session.updatedAt,
          sequence: session.sequence,
        },
      },
    });
  }
}
