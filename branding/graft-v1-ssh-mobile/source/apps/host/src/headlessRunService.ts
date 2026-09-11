import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import {
  CursorStreamParser,
  isCursorModelCatalogHeading,
  parseCursorModels,
  type GraftDesktopJsonValue,
  type NormalizedEvent,
} from "@graft/shared";
import {
  HeadlessHostStore,
  type HeadlessPartRow,
  type HeadlessProviderId,
  type HeadlessRunRow,
} from "./headlessHostStore.js";
import type { HeadlessWorkspace } from "./headlessWorkspace.js";

const execFileAsync = promisify(execFile);
const CANCEL_KILL_GRACE_MS = 2_000;

const PROVIDERS: ReadonlyArray<{
  id: HeadlessProviderId;
  displayName: string;
  binary: string;
}> = [
  { id: "openai", displayName: "Codex", binary: "codex" },
  { id: "anthropic", displayName: "Claude Code", binary: "claude" },
  { id: "google", displayName: "Antigravity", binary: "agy" },
  { id: "copilot", displayName: "GitHub Copilot", binary: "copilot" },
  { id: "cursor", displayName: "Cursor", binary: "cursor-agent" },
  { id: "opencode", displayName: "OpenCode", binary: "opencode" },
  { id: "pi", displayName: "Pi", binary: "pi" },
];

interface ActiveRun {
  run: HeadlessRunRow;
  process: ChildProcessWithoutNullStreams;
  assistantPart: HeadlessPartRow | null;
  assistantPartContent: string;
  cursorStream: CursorStreamParser | null;
  toolCallParts: Map<string, HeadlessPartRow>;
  output: string;
  rawOutput: string;
  stderr: string;
  providerError: string | null;
  settled: boolean;
  cancelRequested: boolean;
  releaseTemporaryUploads: () => void;
}

function once(callback: (() => void) | undefined): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    callback?.();
  };
}

function requirePayload(
  value: GraftDesktopJsonValue | undefined,
): Record<string, GraftDesktopJsonValue> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("A run payload is required");
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function isProvider(value: unknown): value is HeadlessProviderId {
  return PROVIDERS.some((provider) => provider.id === value);
}

function normalizedModel(
  value: GraftDesktopJsonValue | undefined,
): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parsePartMetadata(
  metadata: string,
): Record<string, GraftDesktopJsonValue> {
  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
      return parsed as Record<string, GraftDesktopJsonValue>;
    }
  } catch {
    // Corrupt optional metadata must not prevent the durable part from rendering.
  }
  return {};
}

function liveMessagePart(part: HeadlessPartRow) {
  return {
    id: part.id,
    threadId: part.threadId,
    runId: part.runId,
    parentSubAgentPartId: part.parentSubAgentPartId,
    role: part.role,
    partType: part.partType,
    partIndex: part.partIndex,
    status: part.status,
    content: part.content,
    metadata: parsePartMetadata(part.metadata),
    createdAt: part.createdAt,
    updatedAt: part.updatedAt,
  };
}

function isFullAccess(policy: unknown): boolean {
  return (
    policy === "full-access" ||
    policy === "bypassPermissions" ||
    policy === "danger-full-access" ||
    policy === "yolo"
  );
}

function shellPath(): string {
  return process.env.SHELL || "/bin/bash";
}

async function commandExists(binary: string): Promise<boolean> {
  try {
    await execFileAsync(shellPath(), ["-lc", `command -v ${binary}`], {
      timeout: 2_000,
      encoding: "utf8",
      env: process.env,
    });
    return true;
  } catch {
    return false;
  }
}

function modelArgs(model: string | null, flag = "--model"): string[] {
  return model ? [flag, model] : [];
}

function spawnConfiguration(input: {
  provider: HeadlessProviderId;
  prompt: string;
  model: string | null;
  sessionId: string | null;
  planMode: boolean;
  approvalPolicy: unknown;
}): { binary: string; args: string[] } {
  const provider = PROVIDERS.find(
    (candidate) => candidate.id === input.provider,
  );
  if (!provider) throw new Error("Provider is not supported");
  switch (input.provider) {
    case "openai": {
      const validSessionId =
        input.sessionId && /^[A-Za-z0-9_-]+$/u.test(input.sessionId)
          ? input.sessionId
          : null;
      const args = ["exec"];
      if (validSessionId) args.push("resume");
      args.push("--json", "--skip-git-repo-check");
      if (input.planMode) {
        if (validSessionId) {
          args.push(
            "-c",
            'ask_for_approval="never"',
            "-c",
            'sandbox_mode="read-only"',
          );
        } else {
          args.push("-s", "read-only");
        }
      } else if (isFullAccess(input.approvalPolicy)) {
        args.push("--dangerously-bypass-approvals-and-sandbox");
      } else if (validSessionId) {
        args.push(
          "-c",
          'ask_for_approval="never"',
          "-c",
          'sandbox_mode="workspace-write"',
        );
      } else {
        args.push("-c", 'ask_for_approval="never"', "-s", "workspace-write");
      }
      if (input.model) args.push("-m", input.model);
      if (validSessionId) args.push(validSessionId);
      args.push(input.prompt);
      return { binary: provider.binary, args };
    }
    case "anthropic": {
      const args = [
        "-p",
        input.prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-mode",
        input.planMode
          ? "plan"
          : isFullAccess(input.approvalPolicy)
            ? "bypassPermissions"
            : "acceptEdits",
        ...modelArgs(input.model),
      ];
      if (input.sessionId && /^[A-Za-z0-9_-]+$/u.test(input.sessionId)) {
        args.push("--resume", input.sessionId);
      }
      return { binary: provider.binary, args };
    }
    case "google": {
      const args = [
        "-p",
        input.prompt,
        "--print-timeout",
        "3600",
        ...modelArgs(input.model),
      ];
      if (input.planMode) args.push("--sandbox");
      else args.push("--dangerously-skip-permissions");
      if (input.sessionId) args.push("--continue");
      return { binary: provider.binary, args };
    }
    case "copilot": {
      const args = [
        `--prompt=${input.prompt}`,
        "--output-format=json",
        "-s",
        "--allow-all-tools",
        ...modelArgs(input.model),
      ];
      if (isFullAccess(input.approvalPolicy))
        args.push("--allow-all-paths", "--allow-all-urls");
      if (input.sessionId) args.push(`--resume=${input.sessionId}`);
      return { binary: provider.binary, args };
    }
    case "cursor": {
      const args = [
        "--print",
        "--output-format",
        "stream-json",
        "--stream-partial-output",
        "--trust",
        "--approve-mcps",
        ...modelArgs(input.model),
      ];
      if (input.sessionId) args.push("--resume", input.sessionId);
      if (input.planMode) args.push("--plan");
      else args.push("--force");
      if (isFullAccess(input.approvalPolicy))
        args.push("--sandbox", "disabled");
      args.push(input.prompt);
      return { binary: provider.binary, args };
    }
    case "opencode": {
      const args = ["run", "--format", "json", "--auto"];
      if (input.sessionId) args.push("--session", input.sessionId);
      args.push(...modelArgs(input.model), "--", input.prompt);
      return { binary: provider.binary, args };
    }
    case "pi": {
      const args = ["--mode", "json", "--print"];
      if (input.sessionId) args.push("--session", input.sessionId);
      args.push(...modelArgs(input.model), input.prompt);
      return { binary: provider.binary, args };
    }
    default: {
      const exhaustive: never = input.provider;
      return exhaustive;
    }
  }
}

function stringAtPath(value: unknown, path: readonly string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!current || Array.isArray(current) || typeof current !== "object")
      return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : null;
}

function extractTextFromJson(
  value: unknown,
  provider: HeadlessProviderId,
): {
  text: string | null;
  sessionId: string | null;
} {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return { text: null, sessionId: null };
  }
  const record = value as Record<string, unknown>;
  const sessionId =
    stringAtPath(record, ["thread_id"]) ??
    stringAtPath(record, ["session_id"]) ??
    stringAtPath(record, ["sessionId"]);
  if (provider === "cursor") {
    if (record.type === "result") {
      return { text: stringAtPath(record, ["result"]), sessionId };
    }
    if (record.type !== "assistant") {
      return { text: null, sessionId };
    }
  }
  if (record.type === "thread.started") return { text: null, sessionId };
  if (record.type === "item.updated" || record.type === "item.completed") {
    const item = record.item;
    const text =
      stringAtPath(item, ["text"]) ??
      stringAtPath(item, ["content"]) ??
      stringAtPath(item, ["output"]);
    return { text, sessionId };
  }
  if (record.type === "stream_event") {
    const text =
      stringAtPath(record, ["event", "delta", "text"]) ??
      stringAtPath(record, ["event", "delta", "thinking"]);
    return { text, sessionId };
  }
  const content = stringAtPath(record, ["message", "content"]);
  if (content) return { text: content, sessionId };
  const messageContent = record.message;
  if (
    messageContent &&
    typeof messageContent === "object" &&
    !Array.isArray(messageContent)
  ) {
    const blocks = (messageContent as Record<string, unknown>).content;
    if (Array.isArray(blocks)) {
      const text = blocks
        .map((block) => stringAtPath(block, ["text"]) ?? "")
        .join("");
      if (text) return { text, sessionId };
    }
  }
  const direct =
    stringAtPath(record, ["result"]) ??
    stringAtPath(record, ["text"]) ??
    stringAtPath(record, ["content"]);
  return { text: direct, sessionId };
}

export class HeadlessRunService {
  private readonly activeByThread = new Map<string, ActiveRun>();
  private readonly activeByRun = new Map<string, ActiveRun>();

  constructor(
    private readonly store: HeadlessHostStore,
    private readonly workspace: HeadlessWorkspace,
    private readonly emit: (channel: string, payload: unknown) => void,
  ) {}

  get activeCount(): number {
    return this.activeByRun.size;
  }

  async dispatch(
    type: string,
    rawPayload: GraftDesktopJsonValue | undefined,
    releaseTemporaryUploads?: () => void,
  ): Promise<unknown> {
    const release = once(releaseTemporaryUploads);
    let payload: Record<string, GraftDesktopJsonValue>;
    try {
      payload =
        rawPayload === undefined && type === "run/list"
          ? {}
          : requirePayload(rawPayload);
    } catch (error) {
      release();
      throw error;
    }
    switch (type) {
      case "turn/start": {
        try {
          return this.start(payload, release);
        } catch (error) {
          release();
          throw error;
        }
      }
      case "turn/interrupt":
        return this.interrupt(requireString(payload.threadId, "Thread ID"));
      case "turn/steer":
        return {
          ok: false,
          error: "Start a new turn after the active remote turn finishes",
        };
      case "run/list":
        return this.store.listRuns(
          typeof payload.projectId === "string" ? payload.projectId : undefined,
        );
      case "run/cancel":
        return this.cancelRun(requireString(payload.runId, "Run ID"));
      case "run/retry":
        return {
          ok: false,
          error: "Retry is not available for this remote run",
        };
      case "session/close":
      case "session/clear-context":
        return { ok: true };
      default:
        throw new Error(`Unsupported run command: ${type}`);
    }
  }

  async listProviders(): Promise<unknown> {
    const detected = await Promise.all(
      PROVIDERS.map(async (provider) => {
        const connected = await commandExists(provider.binary);
        return {
          id: provider.id,
          displayName: provider.displayName,
          connected,
          connectionMethod: connected ? "api_key" : "none",
          accountLabel: null,
        };
      }),
    );
    return detected;
  }

  async listModels(
    type: string,
    rawPayload: GraftDesktopJsonValue | undefined,
  ): Promise<unknown> {
    if (type === "provider/openai/models" || type === "model/list") return [];
    let binary: string;
    let args: string[];
    if (type === "provider/cursor/models") {
      binary = "cursor-agent";
      args = ["models"];
    } else if (type === "provider/ollama/models") {
      binary = "ollama";
      args = ["list"];
    } else {
      const payload = requirePayload(rawPayload);
      const provider = payload.providerId;
      if (provider === "google") {
        binary = "agy";
        args = ["models"];
      } else if (provider === "opencode") {
        binary = "opencode";
        args = ["models", "--verbose"];
      } else if (provider === "pi") {
        binary = "pi";
        args = ["--list-models"];
      } else {
        return [];
      }
    }
    try {
      const result = await execFileAsync(binary, args, {
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 2 * 1024 * 1024,
        env: process.env,
      });
      if (type === "provider/cursor/models") {
        return parseCursorModels(result.stdout);
      }
      const seen = new Set<string>();
      const models: Array<{ id: string; label: string }> = [];
      for (const rawLine of result.stdout.split("\n")) {
        const line = rawLine.replace(/\u001b\[[0-9;]*m/gu, "").trim();
        if (!line || /^(model|provider|name|[-=\s]+)$/iu.test(line)) continue;
        const columns = line.split(/\s+/u);
        const id =
          type === "provider/ollama/models"
            ? columns[0]
            : columns.find((column) =>
                /^[A-Za-z0-9][A-Za-z0-9._:/-]+$/u.test(column),
              );
        if (!id || seen.has(id)) continue;
        seen.add(id);
        models.push({ id, label: id });
      }
      return models;
    } catch {
      return [];
    }
  }

  dispose(): void {
    for (const active of this.activeByRun.values()) {
      try {
        active.process.kill("SIGTERM");
      } catch {
        // The provider may already have exited.
      }
      active.releaseTemporaryUploads();
    }
    this.activeByRun.clear();
    this.activeByThread.clear();
  }

  private start(
    payload: Record<string, GraftDesktopJsonValue>,
    releaseTemporaryUploads: () => void,
  ): unknown {
    const threadId = requireString(payload.threadId, "Thread ID");
    if (this.activeByThread.has(threadId)) {
      releaseTemporaryUploads();
      return {
        queued: false,
        decision: { accepted: false, reason: "invalid" },
        error: "This thread already has a running turn",
      };
    }
    const thread = this.store.getThread(threadId);
    if (!thread) {
      releaseTemporaryUploads();
      return {
        queued: false,
        decision: { accepted: false, reason: "invalid" },
        error: "Thread not found",
      };
    }
    const provider = isProvider(payload.providerHint)
      ? payload.providerHint
      : (thread.providerHint ?? "openai");
    const text = requireString(payload.text, "Prompt");
    const attachmentPaths = [
      ...(Array.isArray(payload.filePaths)
        ? payload.filePaths.filter(
            (path): path is string => typeof path === "string",
          )
        : []),
      ...(Array.isArray(payload.imagePreviews)
        ? payload.imagePreviews.flatMap((image) => {
            if (!image || Array.isArray(image) || typeof image !== "object") {
              return [];
            }
            return typeof image.path === "string" ? [image.path] : [];
          })
        : []),
    ];
    const prompt =
      attachmentPaths.length === 0
        ? text
        : `${text}\n\n<attachments>\n${[...new Set(attachmentPaths)]
            .map((path) => `- ${path}`)
            .join("\n")}\n</attachments>`;
    const requestedModel = normalizedModel(payload.model) ?? thread.modelName;
    const model =
      provider === "cursor" &&
      requestedModel &&
      isCursorModelCatalogHeading(requestedModel)
        ? null
        : requestedModel;
    const { root } = this.workspace.resolveWorkspace({
      projectId: thread.projectId,
      ...(thread.worktreeId ? { worktreeId: thread.worktreeId } : {}),
      ...(thread.localPath ? { localPath: thread.localPath } : {}),
    });
    const run = this.store.createRun({
      thread,
      cwdPath: root,
      provider,
      modelName: model,
    });
    this.store.updateThread(thread.id, {
      providerHint: provider,
      modelName: model,
      executionMode: "byom",
      ...(typeof payload.approvalPolicy === "string"
        ? { approvalPolicy: payload.approvalPolicy }
        : {}),
    });
    const userPart = this.store.appendPart({
      threadId,
      runId: run.id,
      role: "user",
      partType: "text",
      status: "complete",
      content:
        typeof payload.displayText === "string" ? payload.displayText : text,
      metadata: JSON.stringify({
        ...(typeof payload.clientTurnId === "string"
          ? { clientTurnId: payload.clientTurnId }
          : {}),
        ...(typeof payload.displayText === "string"
          ? { displayText: payload.displayText }
          : {}),
        ...(typeof payload.composerSerializedText === "string"
          ? { composerSerializedText: payload.composerSerializedText }
          : {}),
        ...(Array.isArray(payload.filePaths)
          ? { filePaths: payload.filePaths }
          : {}),
        ...(Array.isArray(payload.imagePreviews)
          ? { imagePreviews: payload.imagePreviews }
          : {}),
        ...(Array.isArray(payload.browserSnippetAttachments)
          ? { browserSnippetAttachments: payload.browserSnippetAttachments }
          : {}),
        ...(Array.isArray(payload.activeSkills)
          ? { activeSkills: payload.activeSkills }
          : {}),
        ...(Array.isArray(payload.prCommentAttachments)
          ? { prCommentAttachments: payload.prCommentAttachments }
          : {}),
      }),
    });
    this.store.appendEvent({
      threadId,
      runId: run.id,
      type: "user_message",
      payload: {
        type: "user_message",
        text,
        clientTurnId:
          typeof payload.clientTurnId === "string"
            ? payload.clientTurnId
            : undefined,
      },
    });
    this.publishPartCreated(thread.projectId, userPart);
    const configuration = spawnConfiguration({
      provider,
      prompt,
      model,
      sessionId: thread.cliSessionId,
      planMode: payload.planMode === true,
      approvalPolicy: payload.approvalPolicy,
    });
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(configuration.binary, configuration.args, {
        cwd: root,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      releaseTemporaryUploads();
      this.failBeforeSpawn(run, error);
      return {
        queued: false,
        decision: { accepted: false, reason: "invalid" },
        error: error instanceof Error ? error.message : String(error),
        runId: run.id,
      };
    }
    const active: ActiveRun = {
      run,
      process: child,
      assistantPart: null,
      assistantPartContent: "",
      cursorStream: provider === "cursor" ? new CursorStreamParser() : null,
      toolCallParts: new Map(),
      output: "",
      rawOutput: "",
      stderr: "",
      providerError: null,
      settled: false,
      cancelRequested: false,
      releaseTemporaryUploads,
    };
    this.activeByRun.set(run.id, active);
    this.activeByThread.set(thread.id, active);
    this.store.updateRun(run.id, { status: "running" });
    this.publishRunUpdate(run, "running");
    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => this.consumeProviderLine(active, line));
    child.stderr.on("data", (chunk: Buffer) => {
      active.stderr = `${active.stderr}${chunk.toString("utf8")}`.slice(
        -64 * 1024,
      );
    });
    child.once("error", (error) => this.finish(active, false, error.message));
    child.once("exit", (code, signal) => {
      const successful = code === 0 && !active.providerError;
      const reason = successful
        ? null
        : active.providerError ||
          active.stderr.trim() ||
          `Provider exited with ${signal ?? code ?? "an error"}`;
      this.finish(active, successful, reason);
    });
    child.stdin.end();
    return { queued: true, decision: { accepted: true }, runId: run.id };
  }

  private consumeProviderLine(active: ActiveRun, line: string): void {
    active.rawOutput = `${active.rawOutput}${line}\n`.slice(-1024 * 1024);
    if (active.cursorStream) {
      const parsed = active.cursorStream.parse(line);
      if (!parsed) return;
      const events: readonly NormalizedEvent[] = Array.isArray(parsed)
        ? parsed
        : [parsed as NormalizedEvent];
      for (const event of events) this.consumeNormalizedEvent(active, event);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      if (line.trim()) this.appendOutput(active, `${line}\n`);
      return;
    }
    const provider = active.run.modelProvider;
    if (!isProvider(provider)) return;
    const extracted = extractTextFromJson(parsed, provider);
    if (extracted.sessionId) {
      this.store.updateThread(active.run.threadId, {
        cliSessionId: extracted.sessionId,
      });
    }
    if (!extracted.text) return;
    const delta = extracted.text.startsWith(active.output)
      ? extracted.text.slice(active.output.length)
      : extracted.text;
    if (delta) this.appendOutput(active, delta);
  }

  private appendOutput(active: ActiveRun, delta: string): void {
    active.output += delta;
    active.assistantPartContent += delta;
    if (!active.assistantPart) {
      const part = this.store.appendPart({
        threadId: active.run.threadId,
        runId: active.run.id,
        role: "assistant",
        partType: "text",
        status: "streaming",
        content: active.assistantPartContent,
      });
      active.assistantPart = part;
      this.publishPartCreated(active.run.projectId, part);
      return;
    }
    const updated = this.store.updatePart(active.assistantPart.id, {
      content: active.assistantPartContent,
      status: "streaming",
    });
    if (!updated) return;
    active.assistantPart = updated;
    this.publishPartUpdated(active.run.projectId, updated, {
      content: updated.content,
      status: updated.status,
      updatedAt: updated.updatedAt,
    });
  }

  private consumeNormalizedEvent(
    active: ActiveRun,
    event: NormalizedEvent,
  ): void {
    if (
      event.type === "status" &&
      event.message.startsWith("__session_id__:")
    ) {
      this.store.updateThread(active.run.threadId, {
        cliSessionId: event.message.slice("__session_id__:".length),
      });
      return;
    }

    this.store.appendEvent({
      threadId: active.run.threadId,
      runId: active.run.id,
      type: event.type,
      payload: event,
    });

    switch (event.type) {
      case "text_delta":
        this.appendOutput(active, event.text);
        return;
      case "text_done":
        if (active.assistantPart) this.finalizeActiveText(active, "complete");
        else if (event.text) {
          this.appendOutput(active, event.text);
          this.finalizeActiveText(active, "complete");
        }
        return;
      case "tool_call":
        this.finalizeActiveText(active, "complete");
        this.upsertToolCall(active, event);
        return;
      case "tool_result":
        this.completeToolCall(active, event.toolCallId);
        this.createAssistantPart(active, {
          partType: "tool_result",
          status: "complete",
          content: event.output,
          metadata: {
            toolCallId: event.toolCallId,
            isError: event.isError,
          },
        });
        return;
      case "turn_complete":
        if (event.sessionId) {
          this.store.updateThread(active.run.threadId, {
            cliSessionId: event.sessionId,
          });
        }
        this.finalizeActiveText(active, "complete");
        return;
      case "turn_error":
        active.providerError = event.message;
        this.finalizeActiveText(active, "error");
        return;
      case "thinking":
      case "subagent_message":
      case "subagent_started":
      case "subagent_completed":
      case "background_process_started":
      case "background_process_updated":
      case "background_process_completed":
      case "file_edit":
      case "shell_command":
      case "status":
      case "context_boundary":
      case "proposed_plan":
      case "permission_request":
      case "question_request":
      case "user_message":
        return;
      default: {
        const exhaustiveEvent: never = event;
        return exhaustiveEvent;
      }
    }
  }

  private upsertToolCall(
    active: ActiveRun,
    event: Extract<NormalizedEvent, { type: "tool_call" }>,
  ): void {
    const metadata = {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      args: event.args,
    };
    const content = `${event.toolName}(${JSON.stringify(event.args)})`;
    const existing = active.toolCallParts.get(event.toolCallId);
    if (existing) {
      const updated = this.store.updatePart(existing.id, {
        content,
        metadata: JSON.stringify(metadata),
      });
      if (!updated) return;
      active.toolCallParts.set(event.toolCallId, updated);
      this.publishPartUpdated(active.run.projectId, updated, {
        content,
        metadata,
        updatedAt: updated.updatedAt,
      });
      return;
    }

    const part = this.createAssistantPart(active, {
      partType: "tool_call",
      status: "streaming",
      content,
      metadata,
    });
    active.toolCallParts.set(event.toolCallId, part);
  }

  private completeToolCall(active: ActiveRun, toolCallId: string): void {
    const current = active.toolCallParts.get(toolCallId);
    if (!current) return;
    const updated = this.store.updatePart(current.id, { status: "complete" });
    if (!updated) return;
    active.toolCallParts.delete(toolCallId);
    this.publishPartUpdated(active.run.projectId, updated, {
      status: updated.status,
      updatedAt: updated.updatedAt,
    });
  }

  private createAssistantPart(
    active: ActiveRun,
    input: {
      partType: string;
      status: HeadlessPartRow["status"];
      content: string;
      metadata?: Record<string, unknown>;
    },
  ): HeadlessPartRow {
    const part = this.store.appendPart({
      threadId: active.run.threadId,
      runId: active.run.id,
      role: "assistant",
      partType: input.partType,
      status: input.status,
      content: input.content,
      ...(input.metadata ? { metadata: JSON.stringify(input.metadata) } : {}),
    });
    this.publishPartCreated(active.run.projectId, part);
    return part;
  }

  private finalizeActiveText(
    active: ActiveRun,
    status: HeadlessPartRow["status"],
  ): void {
    const current = active.assistantPart;
    if (!current) return;
    const updated = this.store.updatePart(current.id, { status });
    if (updated) {
      this.publishPartUpdated(active.run.projectId, updated, {
        status: updated.status,
        updatedAt: updated.updatedAt,
      });
    }
    active.assistantPart = null;
    active.assistantPartContent = "";
  }

  private finish(
    active: ActiveRun,
    successful: boolean,
    error: string | null,
  ): void {
    if (active.settled) return;
    active.settled = true;
    this.activeByRun.delete(active.run.id);
    this.activeByThread.delete(active.run.threadId);
    const fallback = active.rawOutput.trim();
    if (successful && !active.output && fallback && !active.cursorStream) {
      this.appendOutput(active, fallback);
    }
    const cancelled = active.cancelRequested;
    const status = successful || cancelled ? "complete" : "error";
    this.finalizeActiveText(active, status);
    for (const toolCallId of active.toolCallParts.keys()) {
      this.completeToolCall(active, toolCallId);
    }
    if (!successful && !cancelled && error) {
      this.createAssistantPart(active, {
        partType: "error",
        status: "error",
        content: `Remote provider error: ${error}`,
      });
    }
    this.store.appendEvent({
      threadId: active.run.threadId,
      runId: active.run.id,
      type: successful ? "text_done" : "turn_error",
      payload: successful
        ? { type: "text_done", text: active.output }
        : {
            type: "turn_error",
            message: cancelled
              ? "Interrupted"
              : (error ?? "Remote provider failed"),
            ...(cancelled ? { code: "interrupted" } : {}),
          },
    });
    this.store.updateRun(active.run.id, {
      status: successful ? "success" : cancelled ? "cancelled" : "failed",
      errorMessage: cancelled ? null : error,
      endedAt: Date.now(),
    });
    this.publishRunUpdate(
      active.run,
      successful ? "success" : cancelled ? "cancelled" : "failed",
      cancelled ? null : error,
    );
    active.releaseTemporaryUploads();
    this.emit("codex_desktop:worker:engine:for-view", {
      type: "part:event",
      payload: {
        type: "part:turn_complete",
        projectId: active.run.projectId,
        threadId: active.run.threadId,
        runId: active.run.id,
      },
    });
  }

  private failBeforeSpawn(run: HeadlessRunRow, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.store.updateRun(run.id, {
      status: "failed",
      errorMessage: message,
      endedAt: Date.now(),
    });
    this.publishRunUpdate(run, "failed", message);
    const part = this.store.appendPart({
      threadId: run.threadId,
      runId: run.id,
      role: "assistant",
      partType: "error",
      status: "error",
      content: `Remote provider error: ${message}`,
    });
    this.publishPartCreated(run.projectId, part);
  }

  private publishRunUpdate(
    run: HeadlessRunRow,
    status: HeadlessRunRow["status"],
    error?: string | null,
  ): void {
    this.emit("codex_desktop:worker:scheduler:for-view", {
      type: "run.update",
      payload: {
        runId: run.id,
        projectId: run.projectId,
        threadId: run.threadId,
        status,
        ...(error ? { error } : {}),
      },
    });
  }

  private interrupt(threadId: string): unknown {
    const active = this.activeByThread.get(threadId);
    if (!active) return { ok: true };
    try {
      this.requestCancellation(active);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private cancelRun(runId: string): unknown {
    const active = this.activeByRun.get(runId);
    if (active) {
      this.requestCancellation(active);
      return {
        ok: true,
        runId,
        status: "cancelling",
        phase: "running",
        repeated: false,
      };
    }
    const run = this.store.getRun(runId);
    if (!run) {
      return {
        ok: false,
        runId,
        phase: "terminal",
        retryable: false,
        error: "Run not found",
      };
    }
    return {
      ok: true,
      runId,
      status: "cancelled",
      phase: "terminal",
      repeated: true,
    };
  }

  private requestCancellation(active: ActiveRun): void {
    active.cancelRequested = true;
    active.process.kill("SIGTERM");
    setTimeout(() => {
      if (!active.settled) active.process.kill("SIGKILL");
    }, CANCEL_KILL_GRACE_MS).unref();
  }

  private publishPartCreated(projectId: string, part: HeadlessPartRow): void {
    this.emit("codex_desktop:worker:engine:for-view", {
      type: "part:event",
      payload: {
        type: "part:created",
        projectId,
        part: liveMessagePart(part),
      },
    });
  }

  private publishPartUpdated(
    projectId: string,
    part: HeadlessPartRow,
    changes: Record<string, unknown>,
  ): void {
    this.emit("codex_desktop:worker:engine:for-view", {
      type: "part:event",
      payload: {
        type: "part:updated",
        projectId,
        partId: part.id,
        threadId: part.threadId,
        partType: part.partType,
        changes,
      },
    });
  }
}
