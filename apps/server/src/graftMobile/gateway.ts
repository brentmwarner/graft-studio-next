import { randomUUID } from "node:crypto";
import nodePath from "node:path";

import {
  DEFAULT_MOBILE_CAPABILITIES,
  assertNeverMobile,
  type GraftCommandId,
  type GraftEnvironmentSnapshot,
  type GraftMobileCommand,
  type GraftMobileCommandResult,
  type GraftMobileHostMessage,
  type GraftRemoteErrorCode,
  type GraftRunSummary,
  type GraftThreadUsage,
} from "@graft/mobile-contract";
import {
  CommandId,
  MessageId,
  ProjectId,
  ThreadId,
  type ModelSelection,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type ProviderKind,
  type ProviderListModelsInput,
  type ProviderModelDescriptor,
  type ServerSettings,
} from "@graft/contracts";
import { autoRuntimeModeSelectionIssue } from "@graft/shared/runtimeMode";
import {
  isLocalAbsolutePath,
  isWorkspaceRelativePathSafe,
  workspaceRelativePathOf,
} from "@graft/shared/path";
import { Data, Effect, Option } from "effect";

import { ServerConfig } from "../config";
import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils";
import { GitCore } from "../git/Services/GitCore";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment";
import {
  OrchestrationEngineService,
  type OrchestrationDispatchContext,
} from "../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { ProviderDiscoveryService } from "../provider/Services/ProviderDiscoveryService";
import { listProviderUsage } from "../providerUsage";
import { ServerSettingsService } from "../serverSettings";
import { WorkspaceEntries } from "../workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "../workspace/Services/WorkspaceFileSystem";
import {
  MOBILE_PROVIDER_ORDER,
  defaultModelForProvider,
  mobileThreadProvider,
  mobileThreadProviderLocked,
  toMobileModels,
  toMobilePendingApprovals,
  toMobilePendingQuestions,
  toMobileProject,
  toMobileRun,
  toMobileRuntimeMode,
  toMobileSnapshot,
  toMobileThread,
  toMobileTranscript,
  withMobileEffort,
  withMobileFastMode,
} from "./protocolAdapter";
import { mobilePatchFile } from "./diff";
import { toMobileAllowance, toMobileContextUsage } from "./usage";
import { mobileComposerCommands, prepareMobileSlashMessage } from "./composerCommands";
import { mobileWorkingDiff } from "./workingDiff";

const PROJECTION_WAIT_MS = 5_000;
const PROJECTION_POLL_MS = 25;

// Resolve inside the thread's actual worktree. The shared file service also
// checks real paths so a symlink cannot escape the workspace on read.
function mobileWorkspacePath(reference: string, cwd: string): string | null {
  const relative = isLocalAbsolutePath(reference)
    ? workspaceRelativePathOf(reference, cwd)
    : reference.replace(/^(?:\.\/)+/, "");
  return relative && isWorkspaceRelativePathSafe(relative) ? relative : null;
}

export class GraftMobileCommandError extends Data.TaggedError("GraftMobileCommandError")<{
  readonly code: GraftRemoteErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface GraftMobileGatewayState {
  readonly runThreads: Map<string, string>;
  readonly questionKeys: Map<string, string>;
  readonly commandResponses: Map<string, GraftMobileHostMessage>;
  readonly commandInflight: Map<string, InflightMobileCommand>;
}

export function makeGraftMobileGatewayState(): GraftMobileGatewayState {
  return {
    runThreads: new Map(),
    questionKeys: new Map(),
    commandResponses: new Map(),
    commandInflight: new Map(),
  };
}

export type ClaimedMobileCommand =
  | { readonly kind: "cached"; readonly response: GraftMobileHostMessage }
  | { readonly kind: "pending"; readonly promise: Promise<GraftMobileHostMessage> }
  | {
      readonly kind: "reserved";
      readonly promise: Promise<GraftMobileHostMessage>;
      readonly complete: (response: GraftMobileHostMessage) => void;
    };

interface InflightMobileCommand {
  readonly promise: Promise<GraftMobileHostMessage>;
  readonly settle: (response: GraftMobileHostMessage) => void;
}

export function claimMobileCommand(
  state: GraftMobileGatewayState,
  commandId: string,
): ClaimedMobileCommand {
  const cached = state.commandResponses.get(commandId);
  if (cached) return { kind: "cached", response: cached };
  const pending = state.commandInflight.get(commandId);
  if (pending) return { kind: "pending", promise: pending.promise };
  let settle!: (response: GraftMobileHostMessage) => void;
  const promise = new Promise<GraftMobileHostMessage>((resolve) => {
    settle = resolve;
  });
  const inflight: InflightMobileCommand = { promise, settle };
  state.commandInflight.set(commandId, inflight);
  return {
    kind: "reserved",
    promise,
    complete: (response) => {
      if (state.commandInflight.get(commandId) !== inflight) return;
      state.commandResponses.set(commandId, response);
      if (state.commandResponses.size > 2_000) {
        const oldest = state.commandResponses.keys().next().value;
        if (oldest) state.commandResponses.delete(oldest);
      }
      state.commandInflight.delete(commandId);
      settle(response);
    },
  };
}

export function abortMobileCommand(
  state: GraftMobileGatewayState,
  commandId: string,
  response: GraftMobileHostMessage,
): void {
  const inflight = state.commandInflight.get(commandId);
  if (!inflight) return;
  state.commandInflight.delete(commandId);
  inflight.settle(response);
}

export function closedMobileCommandResponse(commandId: string): GraftMobileHostMessage {
  return {
    envelope: "response",
    commandId,
    receipt: {
      commandId,
      status: "rejected",
      errorCode: "internal",
      message: "The mobile connection closed before this command finished.",
    },
  };
}

function fail(
  code: GraftRemoteErrorCode,
  message: string,
  cause?: unknown,
): Effect.Effect<never, GraftMobileCommandError> {
  return Effect.fail(new GraftMobileCommandError({ code, message, ...(cause ? { cause } : {}) }));
}

function providerFromString(value: string): ProviderKind | null {
  return MOBILE_PROVIDER_ORDER.find((provider) => provider === value) ?? null;
}

function modelSelection(provider: ProviderKind, model: string): ModelSelection {
  switch (provider) {
    case "codex":
      return { provider, model };
    case "claudeAgent":
      return { provider, model };
    case "cursor":
      return { provider, model };
    case "devin":
      return { provider, model };
    case "antigravity":
      return { provider, model };
    case "grok":
      return { provider, model };
    case "droid":
      return { provider, model };
    case "opencode":
      return { provider, model };
    case "pi":
      return { provider, model };
    default:
      return assertNeverMobile(provider);
  }
}

function resolveSelection(input: {
  readonly providerId?: string;
  readonly modelId?: string;
  readonly fallback?: ModelSelection | null;
}): Effect.Effect<ModelSelection, GraftMobileCommandError> {
  const provider = input.providerId
    ? providerFromString(input.providerId)
    : (input.fallback?.provider ?? "codex");
  if (!provider) {
    return fail("validation_failed", `Unknown provider '${input.providerId}'.`);
  }
  const model = input.modelId?.trim() || input.fallback?.model || defaultModelForProvider(provider);
  if (!model) {
    return fail("validation_failed", `Select a model for ${provider}.`);
  }
  return Effect.succeed(modelSelection(provider, model));
}

function mobileRuntimeModeForSelection(value: string | undefined, selection: ModelSelection) {
  const runtimeMode = toMobileRuntimeMode(value);
  return autoRuntimeModeSelectionIssue({ runtimeMode, modelSelection: selection })
    ? "approval-required"
    : runtimeMode;
}

function providerDiscoveryInput(
  provider: ProviderKind,
  settings: ServerSettings,
  cwd: string,
): ProviderListModelsInput {
  const providerSettings = settings.providers[provider];
  const binaryPath = providerSettings.binaryPath.trim();
  switch (provider) {
    case "cursor": {
      const apiEndpoint = settings.providers.cursor.apiEndpoint.trim();
      return {
        provider,
        cwd,
        ...(binaryPath ? { binaryPath } : {}),
        ...(apiEndpoint ? { apiEndpoint } : {}),
      };
    }
    case "pi": {
      const agentDir = settings.providers.pi.agentDir.trim();
      return {
        provider,
        cwd,
        ...(binaryPath ? { binaryPath } : {}),
        ...(agentDir ? { agentDir } : {}),
      };
    }
    case "codex":
    case "claudeAgent":
    case "devin":
    case "antigravity":
    case "grok":
    case "droid":
    case "opencode":
      return { provider, cwd, ...(binaryPath ? { binaryPath } : {}) };
    default:
      return assertNeverMobile(provider);
  }
}

const loadModels = Effect.fn(function* () {
  const discovery = yield* ProviderDiscoveryService;
  const settingsService = yield* ServerSettingsService;
  const config = yield* ServerConfig;
  const settings = yield* settingsService.getSettings;
  const enabledProviders = new Set(
    MOBILE_PROVIDER_ORDER.filter((provider) => settings.providers[provider].enabled),
  );
  const discoveredEntries = yield* Effect.forEach(
    // Both mobile composers load this catalog on open/reconnect. Droid model
    // discovery starts an authenticated ACP session, so serve its built-in
    // choices without starting that runtime as a side effect of browsing.
    [...enabledProviders].filter((provider) => provider !== "droid"),
    (provider) =>
      discovery.listModels(providerDiscoveryInput(provider, settings, config.cwd)).pipe(
        // One slow provider must not hold every model picker behind discovery.
        // The adapter merges built-in choices when a runtime catalog is unavailable.
        Effect.timeout("4 seconds"),
        Effect.map((result) => [provider, result.models] as const),
        Effect.catch(() => Effect.succeed([provider, [] as ProviderModelDescriptor[]] as const)),
      ),
    { concurrency: "unbounded" },
  );
  return toMobileModels({
    enabledProviders,
    discoveredModels: new Map(discoveredEntries),
  });
});

const loadThreadDetails = Effect.fn(function* (threadIds: ReadonlyArray<string>) {
  const query = yield* ProjectionSnapshotQuery;
  return yield* Effect.forEach(
    [...new Set(threadIds)],
    (threadId) =>
      query
        .getThreadDetailSnapshotById(ThreadId.makeUnsafe(threadId))
        .pipe(Effect.map((detail) => (Option.isSome(detail) ? detail.value.thread : null))),
    { concurrency: 4 },
  ).pipe(
    Effect.map((threads) =>
      threads.filter((thread): thread is OrchestrationThread => thread !== null),
    ),
  );
});

export const loadMobileSnapshot = Effect.fn(function* (
  selectedThreadId?: string,
): Effect.fn.Return<
  GraftEnvironmentSnapshot,
  unknown,
  ProjectionSnapshotQuery | ServerEnvironment
> {
  const query = yield* ProjectionSnapshotQuery;
  const environment = yield* ServerEnvironment;
  const shell = yield* query.getShellSnapshot();
  const detailIds = shell.threads
    .filter(
      (thread) =>
        thread.id === selectedThreadId ||
        thread.hasPendingApprovals === true ||
        thread.hasPendingUserInput === true,
    )
    .map((thread) => thread.id);
  const details = yield* loadThreadDetails(detailIds);
  const descriptor = yield* environment.getDescriptor;
  return toMobileSnapshot({
    descriptor,
    capabilities: [...DEFAULT_MOBILE_CAPABILITIES],
    cursor: shell.snapshotSequence,
    projects: shell.projects,
    threads: shell.threads,
    details,
    ...(selectedThreadId ? { selectedThreadId } : {}),
  });
});

const loadThreadDetail = Effect.fn(function* (threadId: string) {
  const query = yield* ProjectionSnapshotQuery;
  const detail = yield* query.getThreadDetailSnapshotById(ThreadId.makeUnsafe(threadId));
  if (Option.isNone(detail)) {
    return yield* fail("not_found", "Thread not found.");
  }
  return detail.value;
});

export const loadMobileUsage = Effect.fn(function* (threadId: string) {
  const { thread } = yield* loadThreadDetail(threadId);
  const providerId = mobileThreadProvider(thread);
  const snapshots = yield* listProviderUsage({ provider: providerId }).pipe(
    Effect.catch(() => Effect.succeed([])),
  );
  const contextUsage = toMobileContextUsage(thread.activities);
  const usage: GraftThreadUsage = {
    threadId,
    ...(contextUsage ? { contextUsage } : {}),
    allowance: toMobileAllowance(
      providerId,
      snapshots.find((item) => item.provider === providerId),
    ),
  };
  return usage;
});

const loadThreadWorkspace = Effect.fn(function* (threadId: string) {
  const query = yield* ProjectionSnapshotQuery;
  const current = yield* query.getThreadShellById(ThreadId.makeUnsafe(threadId));
  if (Option.isNone(current)) return yield* fail("not_found", "Thread not found.");
  const project = yield* query.getProjectShellById(current.value.projectId);
  const cwd = resolveThreadWorkspaceCwd({
    thread: current.value,
    projects: Option.isSome(project) ? [project.value] : [],
  });
  if (!cwd) return yield* fail("not_found", "Thread workspace is unavailable.");
  return { thread: current.value, cwd };
});

const loadComposerCommands = Effect.fn(function* (threadId: string) {
  const { thread, cwd } = yield* loadThreadWorkspace(threadId);
  const discovery = yield* ProviderDiscoveryService;
  const settings = yield* ServerSettingsService;
  const input = {
    ...providerDiscoveryInput(thread.modelSelection.provider, yield* settings.getSettings, cwd),
    cwd,
    threadId: thread.id,
  };
  const [commands, skills] = yield* Effect.all(
    [discovery.listCommands(input), discovery.listSkills(input)],
    { concurrency: 2 },
  );
  return {
    commands: mobileComposerCommands(
      commands.commands,
      skills.skills,
      thread.modelSelection.provider === "codex" && thread.interactionMode !== "plan",
    ),
    skills: skills.skills,
  };
});

const prepareMobileMessage = Effect.fn(function* (threadId: string, text: string) {
  if (!/^\/[^\s/]+(?:\s|$)/.test(text.trim())) return { text };
  const catalog = yield* loadComposerCommands(threadId);
  return yield* Effect.try({
    try: () => prepareMobileSlashMessage(text, catalog.commands, catalog.skills),
    catch: (cause) =>
      new GraftMobileCommandError({
        code: "validation_failed",
        message: cause instanceof Error ? cause.message : "Command unavailable.",
      }),
  });
});

const waitForThreadShell = Effect.fn(function* (threadId: string, minimumSequence: number) {
  const query = yield* ProjectionSnapshotQuery;
  const deadline = Date.now() + PROJECTION_WAIT_MS;
  while (true) {
    const shell = yield* query.getShellSnapshot();
    const thread = shell.threads.find((candidate) => candidate.id === threadId);
    if (thread && shell.snapshotSequence >= minimumSequence) return thread;
    if (Date.now() >= deadline) {
      return yield* fail(
        "internal",
        "Graft accepted the change but its mobile snapshot did not catch up in time.",
      );
    }
    yield* Effect.sleep(PROJECTION_POLL_MS);
  }
});

const waitForActiveRun = Effect.fn(function* (
  threadId: string,
  minimumSequence: number,
): Effect.fn.Return<GraftRunSummary | null, unknown, ProjectionSnapshotQuery> {
  const query = yield* ProjectionSnapshotQuery;
  const deadline = Date.now() + PROJECTION_WAIT_MS;
  while (true) {
    const shell = yield* query.getShellSnapshot();
    const thread = shell.threads.find((candidate) => candidate.id === threadId);
    const run = thread ? toMobileRun(thread) : null;
    if (run && shell.snapshotSequence >= minimumSequence) return run;
    if (Date.now() >= deadline) return null;
    yield* Effect.sleep(PROJECTION_POLL_MS);
  }
});

const resolveRunThread = Effect.fn(function* (state: GraftMobileGatewayState, runId: string) {
  const query = yield* ProjectionSnapshotQuery;
  const shell = yield* query.getShellSnapshot();
  const thread = shell.threads.find((candidate) => candidate.latestTurn?.turnId === runId);
  const threadId = thread?.id ?? state.runThreads.get(runId);
  if (!threadId) return yield* fail("not_found", "Active run not found.");
  return { threadId, thread };
});

function activeRun(thread: OrchestrationThreadShell): GraftRunSummary | null {
  const run = toMobileRun(thread);
  return run && ["queued", "running", "waiting"].includes(run.status) ? run : null;
}

function firstQuestionKey(thread: OrchestrationThread, requestId: string): string | null {
  for (const activity of thread.activities.toReversed()) {
    if (activity.kind !== "user-input.requested") continue;
    const payload = activity.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
    const record = payload as Record<string, unknown>;
    if (record.requestId !== requestId || !Array.isArray(record.questions)) continue;
    for (const question of record.questions) {
      if (!question || typeof question !== "object" || Array.isArray(question)) continue;
      const id = (question as Record<string, unknown>).id;
      if (typeof id === "string" && id.length > 0) return id;
    }
  }
  return null;
}

const findPendingInteraction = Effect.fn(function* (
  requestId: string,
  interactionKind: "approval" | "userInput",
) {
  const query = yield* ProjectionSnapshotQuery;
  const shell = yield* query.getShellSnapshot();
  const likelyIds = shell.threads
    .filter((thread) =>
      interactionKind === "approval"
        ? thread.hasPendingApprovals === true
        : thread.hasPendingUserInput === true,
    )
    .map((thread) => thread.id);
  const details = yield* loadThreadDetails(likelyIds);
  for (const thread of details) {
    const interaction = thread.pendingInteractions?.find(
      (candidate) =>
        candidate.requestId === requestId && candidate.interactionKind === interactionKind,
    );
    if (interaction) return { thread, interaction };
  }
  return yield* fail("not_found", "Pending interaction not found.");
});

export const executeMobileCommand = Effect.fn(function* (
  state: GraftMobileGatewayState,
  commandIdRaw: GraftCommandId,
  command: GraftMobileCommand,
  context?: OrchestrationDispatchContext,
): Effect.fn.Return<
  GraftMobileCommandResult,
  unknown,
  | OrchestrationEngineService
  | ProjectionSnapshotQuery
  | ProviderDiscoveryService
  | ServerConfig
  | ServerEnvironment
  | ServerSettingsService
  | GitCore
  | WorkspaceEntries
  | WorkspaceFileSystem
> {
  const engine = yield* OrchestrationEngineService;
  const query = yield* ProjectionSnapshotQuery;
  const commandId = CommandId.makeUnsafe(commandIdRaw);
  const createdAt = new Date().toISOString();

  switch (command.type) {
    case "project.list": {
      const shell = yield* query.getShellSnapshot();
      return { type: "project.list.result", projects: shell.projects.map(toMobileProject) };
    }
    case "thread.list": {
      const shell = yield* query.getShellSnapshot();
      const normalizedQuery = command.query?.trim().toLowerCase();
      const threads = shell.threads.filter(
        (thread) =>
          (!command.projectId || thread.projectId === command.projectId) &&
          (!normalizedQuery || thread.title.toLowerCase().includes(normalizedQuery)),
      );
      return { type: "thread.list.result", threads: threads.map(toMobileThread) };
    }
    case "thread.open": {
      const detail = yield* loadThreadDetail(command.threadId);
      const run = activeRun(detail.thread);
      return {
        type: "thread.open.result",
        transcript: toMobileTranscript(detail.thread, detail.snapshotSequence),
        run,
        pendingApprovals: toMobilePendingApprovals(detail.thread),
        pendingQuestions: toMobilePendingQuestions(detail.thread),
      };
    }
    case "thread.create": {
      const project = yield* query.getProjectShellById(ProjectId.makeUnsafe(command.projectId));
      if (Option.isNone(project)) return yield* fail("not_found", "Project not found.");
      const selection = yield* resolveSelection({
        ...(command.providerId ? { providerId: command.providerId } : {}),
        ...(command.modelId ? { modelId: command.modelId } : {}),
        fallback: project.value.defaultModelSelection,
      });
      const threadId = ThreadId.makeUnsafe(randomUUID());
      const result = yield* engine.dispatch({
        type: "thread.create",
        commandId,
        threadId,
        projectId: ProjectId.makeUnsafe(command.projectId),
        title: command.title?.trim() || "New chat",
        modelSelection: selection,
        runtimeMode: mobileRuntimeModeForSelection(command.approvalPolicy, selection),
        interactionMode: "default",
        envMode: command.mode ?? "local",
        branch: null,
        worktreePath: null,
        createdAt,
      });
      const thread = yield* waitForThreadShell(threadId, result.sequence);
      return { type: "thread.create.result", thread: toMobileThread(thread) };
    }
    case "thread.set_model": {
      const current = yield* query.getThreadShellById(ThreadId.makeUnsafe(command.threadId));
      if (Option.isNone(current)) return yield* fail("not_found", "Thread not found.");
      const currentProvider = mobileThreadProvider(current.value);
      const selection = yield* resolveSelection({
        providerId: command.providerId ?? currentProvider,
        modelId: command.modelId,
        fallback: current.value.modelSelection,
      });
      if (mobileThreadProviderLocked(current.value) && selection.provider !== currentProvider) {
        return yield* fail(
          "conflict",
          "This chat's provider is locked. Choose a model from the same provider or start a new chat.",
        );
      }
      if (
        autoRuntimeModeSelectionIssue({
          runtimeMode: current.value.runtimeMode,
          modelSelection: selection,
        })
      ) {
        const runtimeResult = yield* engine.dispatch({
          type: "thread.runtime-mode.set",
          commandId: CommandId.makeUnsafe(randomUUID()),
          threadId: ThreadId.makeUnsafe(command.threadId),
          runtimeMode: "approval-required",
          createdAt,
        });
        yield* waitForThreadShell(command.threadId, runtimeResult.sequence);
      }
      const result = yield* engine.dispatch({
        type: "thread.meta.update",
        commandId,
        threadId: ThreadId.makeUnsafe(command.threadId),
        modelSelection: selection,
      });
      const thread = yield* waitForThreadShell(command.threadId, result.sequence);
      return { type: "thread.set_model.result", thread: toMobileThread(thread) };
    }
    case "thread.set_approval": {
      const current = yield* query.getThreadShellById(ThreadId.makeUnsafe(command.threadId));
      if (Option.isNone(current)) return yield* fail("not_found", "Thread not found.");
      const result = yield* engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId,
        threadId: ThreadId.makeUnsafe(command.threadId),
        runtimeMode: mobileRuntimeModeForSelection(
          command.approvalPolicy,
          current.value.modelSelection,
        ),
        createdAt,
      });
      const thread = yield* waitForThreadShell(command.threadId, result.sequence);
      return { type: "thread.set_approval.result", thread: toMobileThread(thread) };
    }
    case "models.list":
      return { type: "models.list.result", models: yield* loadModels() };
    case "composer.commands":
      return {
        type: "composer.commands.result",
        commands: (yield* loadComposerCommands(command.threadId)).commands,
      };
    case "composer.skill.read": {
      const catalog = yield* loadComposerCommands(command.threadId);
      // The phone supplies a catalog name, never a filesystem path. Recheck the
      // current provider's enabled skills before reading its discovered file.
      const skill = catalog.skills.find((entry) => entry.enabled && entry.name === command.name);
      if (
        !skill ||
        !catalog.commands.some((entry) => entry.kind === "skill" && entry.name === skill.name)
      )
        return yield* fail("not_found", "This skill is no longer available. Reopen the / menu.");
      const files = yield* WorkspaceFileSystem;
      const file = yield* files.readFile({
        cwd: nodePath.dirname(skill.path),
        relativePath: nodePath.basename(skill.path),
        maxBytes: 80_000,
      });
      return {
        type: "composer.skill.read.result",
        skill: {
          name: skill.name,
          description: skill.description ?? skill.interface?.shortDescription ?? "",
          contents: file.contents,
          truncated: file.truncated,
        },
      };
    }
    case "files.resolve": {
      const { cwd } = yield* loadThreadWorkspace(command.threadId);
      const entries = yield* WorkspaceEntries;
      const candidates = command.references.map((reference) => mobileWorkspacePath(reference, cwd));
      const validPaths = candidates.filter((candidate): candidate is string => candidate !== null);
      const resolved = validPaths.length
        ? (yield* entries.resolveFileReferences({ cwd, relativePaths: validPaths })).relativePaths
        : [];
      let index = 0;
      return {
        type: "files.resolve.result",
        references: command.references.map((reference, candidateIndex) => ({
          reference,
          path: candidates[candidateIndex] === null ? null : (resolved[index++] ?? null),
        })),
      };
    }
    case "file.read": {
      const { cwd } = yield* loadThreadWorkspace(command.threadId);
      const relativePath = mobileWorkspacePath(command.path, cwd);
      if (!relativePath)
        return yield* fail("validation_failed", "This file is outside the thread workspace.");
      const files = yield* WorkspaceFileSystem;
      const file = yield* files.readFile({ cwd, relativePath, maxBytes: 80_000 });
      return {
        type: "file.read.result",
        file: { path: file.relativePath, contents: file.contents, truncated: file.truncated },
      };
    }
    case "turn.start": {
      const current = yield* query.getThreadShellById(ThreadId.makeUnsafe(command.threadId));
      if (Option.isNone(current)) return yield* fail("not_found", "Thread not found.");
      const message = yield* prepareMobileMessage(command.threadId, command.text);
      const result = yield* engine.dispatch(
        {
          type: "thread.turn.start",
          commandId,
          threadId: ThreadId.makeUnsafe(command.threadId),
          message: {
            messageId: MessageId.makeUnsafe(randomUUID()),
            role: "user",
            ...message,
            attachments: command.attachments ?? [],
          },
          modelSelection: withMobileFastMode(
            withMobileEffort(current.value.modelSelection, command.effort),
            command.fastMode,
          ),
          runtimeMode: current.value.runtimeMode,
          interactionMode: command.interactionMode ?? current.value.interactionMode,
          assistantDeliveryMode: "streaming",
          createdAt,
        },
        context,
      );
      const projectedRun = yield* waitForActiveRun(command.threadId, result.sequence);
      const run: GraftRunSummary = projectedRun ?? {
        id: commandIdRaw,
        threadId: command.threadId,
        projectId: current.value.projectId,
        status: "queued",
        startedAt: Date.now(),
        title: current.value.title,
      };
      state.runThreads.set(run.id, command.threadId);
      return { type: "turn.start.result", run };
    }
    case "turn.cancel": {
      const resolved = yield* resolveRunThread(state, command.runId);
      yield* engine.dispatch({
        type: "thread.turn.interrupt",
        commandId,
        threadId: ThreadId.makeUnsafe(resolved.threadId),
        ...(resolved.thread?.latestTurn?.turnId
          ? { turnId: resolved.thread.latestTurn.turnId }
          : {}),
        createdAt,
      });
      state.runThreads.delete(command.runId);
      return { type: "turn.cancel.result", runId: command.runId };
    }
    case "turn.steer": {
      const resolved = yield* resolveRunThread(state, command.runId);
      const message = yield* prepareMobileMessage(resolved.threadId, command.text);
      const current =
        resolved.thread ??
        (yield* query
          .getThreadShellById(ThreadId.makeUnsafe(resolved.threadId))
          .pipe(
            Effect.flatMap((thread) =>
              Option.isSome(thread)
                ? Effect.succeed(thread.value)
                : fail("not_found", "Thread not found."),
            ),
          ));
      yield* engine.dispatch({
        type: "thread.turn.start",
        commandId,
        threadId: ThreadId.makeUnsafe(resolved.threadId),
        message: {
          messageId: MessageId.makeUnsafe(randomUUID()),
          role: "user",
          ...message,
          attachments: [],
        },
        modelSelection: current.modelSelection,
        runtimeMode: current.runtimeMode,
        interactionMode: current.interactionMode,
        assistantDeliveryMode: "streaming",
        dispatchMode: "steer",
        createdAt,
      });
      return { type: "turn.steer.result", runId: command.runId };
    }
    case "approval.resolve": {
      const pending = yield* findPendingInteraction(command.approvalId, "approval");
      const decision =
        command.decision === "allow_once"
          ? "accept"
          : command.decision === "allow_session"
            ? "acceptForSession"
            : "decline";
      yield* engine.dispatch({
        type: "thread.approval.respond",
        commandId,
        threadId: pending.thread.id,
        requestId: pending.interaction.requestId,
        ...(pending.interaction.lifecycleGeneration
          ? { lifecycleGeneration: pending.interaction.lifecycleGeneration }
          : {}),
        decision,
        createdAt,
      });
      return {
        type: "approval.resolve.result",
        approvalId: command.approvalId,
        decision: command.decision,
      };
    }
    case "question.resolve": {
      const pending = yield* findPendingInteraction(command.questionId, "userInput");
      const questionKey =
        state.questionKeys.get(command.questionId) ??
        firstQuestionKey(pending.thread, command.questionId) ??
        "answer";
      state.questionKeys.set(command.questionId, questionKey);
      const answer = command.text?.trim() || command.optionId?.trim();
      if (!answer) return yield* fail("validation_failed", "An answer is required.");
      yield* engine.dispatch({
        type: "thread.user-input.respond",
        commandId,
        threadId: pending.thread.id,
        requestId: pending.interaction.requestId,
        ...(pending.interaction.lifecycleGeneration
          ? { lifecycleGeneration: pending.interaction.lifecycleGeneration }
          : {}),
        answers: { [questionKey]: answer },
        createdAt,
      });
      return { type: "question.resolve.result", questionId: command.questionId };
    }
    case "diff.get": {
      const { cwd } = yield* loadThreadWorkspace(command.diffId);
      const git = yield* GitCore;
      const status = yield* git.status({ cwd });
      const porcelain = status.hasWorkingTreeChanges
        ? (yield* git.execute({
            operation: "mobile.diff.status",
            cwd,
            args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
          })).stdout
        : "";
      const diff = mobileWorkingDiff(command.diffId, status.workingTree, porcelain);
      const requested = diff.files.find((file) => file.path === command.filePath);
      if (requested) {
        const detail = yield* git.readWorkingTreePatch(cwd, requested.path).pipe(
          Effect.flatMap(({ patch, truncated }) =>
            mobilePatchFile(requested, patch).pipe(
              Effect.map((file) =>
                truncated ? { ...file, detailStatus: "truncated" as const } : file,
              ),
            ),
          ),
          Effect.catch(() =>
            Effect.succeed({ ...requested, detailStatus: "unavailable" as const }),
          ),
        );
        diff.files = diff.files.map((file) => (file.path === requested.path ? detail : file));
      }
      return { type: "diff.get.result", diff };
    }
    case "cursor.replay": {
      // First slice: ask the client for a snapshot instead of replaying an
      // event range. A later PR can stream stored events between afterCursor
      // and latestCursor.
      const latestCursor = yield* engine.getEventHighWaterSequence;
      return {
        type: "cursor.replay.result",
        replay: {
          afterCursor: command.afterCursor,
          events: [],
          latestCursor,
          snapshotRequired: command.afterCursor < latestCursor,
        },
      };
    }
    case "snapshot.get":
      return {
        type: "snapshot.get.result",
        snapshot: yield* loadMobileSnapshot(command.threadId),
      };
    default:
      return assertNeverMobile(command);
  }
});
