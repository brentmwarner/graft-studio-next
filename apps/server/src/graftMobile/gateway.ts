import { randomUUID } from "node:crypto";

import {
  DEFAULT_MOBILE_CAPABILITIES,
  type GraftCommandId,
  type GraftEnvironmentSnapshot,
  type GraftMobileCommand,
  type GraftMobileCommandResult,
  type GraftMobileHostMessage,
  type GraftRemoteErrorCode,
  type GraftRunSummary,
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
} from "@synara/contracts";
import { autoRuntimeModeSelectionIssue } from "@synara/shared/runtimeMode";
import { Data, Effect, Option } from "effect";

import { ServerConfig } from "../config";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { ProviderDiscoveryService } from "../provider/Services/ProviderDiscoveryService";
import { ServerSettingsService } from "../serverSettings";
import {
  MOBILE_PROVIDER_ORDER,
  defaultModelForProvider,
  toMobileDiff,
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
} from "./protocolAdapter";

const PROJECTION_WAIT_MS = 5_000;
const PROJECTION_POLL_MS = 25;

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
    [...enabledProviders],
    (provider) =>
      discovery.listModels(providerDiscoveryInput(provider, settings, config.cwd)).pipe(
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
        "Synara accepted the change but its mobile snapshot did not catch up in time.",
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
): Effect.fn.Return<
  GraftMobileCommandResult,
  unknown,
  | OrchestrationEngineService
  | ProjectionSnapshotQuery
  | ProviderDiscoveryService
  | ServerConfig
  | ServerEnvironment
  | ServerSettingsService
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
      const selection = yield* resolveSelection({
        ...(command.providerId ? { providerId: command.providerId } : {}),
        modelId: command.modelId,
        fallback: current.value.modelSelection,
      });
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
    case "turn.start": {
      const current = yield* query.getThreadShellById(ThreadId.makeUnsafe(command.threadId));
      if (Option.isNone(current)) return yield* fail("not_found", "Thread not found.");
      const result = yield* engine.dispatch({
        type: "thread.turn.start",
        commandId,
        threadId: ThreadId.makeUnsafe(command.threadId),
        message: {
          messageId: MessageId.makeUnsafe(randomUUID()),
          role: "user",
          text: command.text,
          attachments: [],
        },
        modelSelection: withMobileEffort(current.value.modelSelection, command.effort),
        runtimeMode: current.value.runtimeMode,
        interactionMode: current.value.interactionMode,
        assistantDeliveryMode: "streaming",
        createdAt,
      });
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
          text: command.text,
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
      const detail = yield* loadThreadDetail(command.diffId);
      return {
        type: "diff.get.result",
        diff: toMobileDiff(command.diffId, detail.thread.checkpoints.at(-1)),
      };
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
  }
});
