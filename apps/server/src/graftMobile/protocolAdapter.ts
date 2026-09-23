import { assertNeverMobile } from "@graft/mobile-contract";
import type {
  GraftApprovalPolicyOption,
  GraftApprovalRequest,
  GraftDiffFileSummary,
  GraftDiffSummary,
  GraftEnvironmentSnapshot,
  GraftEnvironmentSummary,
  GraftModelOption,
  GraftProjectSummary,
  GraftQuestionRequest,
  GraftRunStatus,
  GraftRunSummary,
  GraftThreadStatus,
  GraftThreadSummary,
  GraftTimelineEvent,
  GraftTimelineEventData,
  GraftTimelineEventKind,
  GraftTranscriptSnapshot,
} from "@graft/mobile-contract";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  MODEL_OPTIONS_BY_PROVIDER,
  PROVIDER_DISPLAY_NAMES,
  type ExecutionEnvironmentDescriptor,
  type ModelSelection,
  type OrchestrationCheckpointFile,
  type OrchestrationCheckpointSummary,
  type OrchestrationEvent,
  type OrchestrationProjectShell,
  type OrchestrationSessionStatus,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  type OrchestrationThreadShell,
  type ProviderKind,
  type ProviderModelDescriptor,
  type RuntimeMode,
} from "@graft/contracts";

import { toMobileContextUsage } from "./usage";

export const MOBILE_PROVIDER_ORDER = [
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "droid",
  "opencode",
  "pi",
  "devin",
  "antigravity",
] as const satisfies ReadonlyArray<ProviderKind>;

export const MOBILE_APPROVAL_POLICY_OPTIONS: ReadonlyArray<GraftApprovalPolicyOption> = [
  {
    value: "approval-required",
    label: "Ask first",
    description: "Pause before commands or file changes that need approval.",
  },
  {
    value: "full-access",
    label: "Full access",
    description: "Run without approval prompts.",
  },
];

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isStudioProjectKind(project: Pick<OrchestrationProjectShell, "kind">): boolean {
  return project.kind === "studio";
}

export function withoutStudioProjects<T extends Pick<OrchestrationProjectShell, "kind">>(
  projects: readonly T[],
): T[] {
  return projects.filter((project) => !isStudioProjectKind(project));
}

export function withoutStudioThreads<T extends { readonly projectId: string }>(
  threads: readonly T[],
  projects: ReadonlyArray<Pick<OrchestrationProjectShell, "id" | "kind">>,
): T[] {
  const studioProjectIds = new Set<string>(
    projects.filter(isStudioProjectKind).map((project) => project.id),
  );
  if (studioProjectIds.size === 0) {
    return [...threads];
  }
  return threads.filter((thread) => !studioProjectIds.has(thread.projectId));
}

export function rememberHiddenStudioFromShell(
  projects: ReadonlyArray<Pick<OrchestrationProjectShell, "id" | "kind">>,
  threads: ReadonlyArray<{ readonly id: string; readonly projectId: string }>,
  hidden: { studioProjectIds: Set<string>; studioThreadIds: Set<string> },
): void {
  for (const project of projects) {
    if (isStudioProjectKind(project)) {
      hidden.studioProjectIds.add(project.id);
    }
  }
  for (const thread of threads) {
    if (hidden.studioProjectIds.has(thread.projectId)) {
      hidden.studioThreadIds.add(thread.id);
    }
  }
}

function eventProjectId(event: Pick<OrchestrationEvent, "payload">): string | undefined {
  const payload = event.payload;
  if (payload && typeof payload === "object" && "projectId" in payload) {
    const projectId = payload.projectId;
    if (typeof projectId === "string") {
      return projectId;
    }
  }
  return undefined;
}

export function rememberHiddenStudioFromEvent(
  event: OrchestrationEvent,
  hidden: { studioProjectIds: Set<string>; studioThreadIds: Set<string> },
): void {
  if (event.type === "project.created" && event.payload.kind === "studio") {
    hidden.studioProjectIds.add(event.payload.projectId);
    return;
  }
  if (event.aggregateKind !== "thread") {
    return;
  }
  const projectId = eventProjectId(event);
  if (projectId && hidden.studioProjectIds.has(projectId)) {
    hidden.studioThreadIds.add(String(event.aggregateId));
  }
}

export function isHiddenStudioMobileEvent(
  event: OrchestrationEvent,
  hidden: {
    readonly studioProjectIds: ReadonlySet<string>;
    readonly studioThreadIds: ReadonlySet<string>;
  },
): boolean {
  if (event.aggregateKind === "project") {
    if (hidden.studioProjectIds.has(String(event.aggregateId))) {
      return true;
    }
    return event.type === "project.created" && event.payload.kind === "studio";
  }
  if (event.aggregateKind === "thread") {
    if (hidden.studioThreadIds.has(String(event.aggregateId))) {
      return true;
    }
    const projectId = eventProjectId(event);
    return projectId !== undefined && hidden.studioProjectIds.has(projectId);
  }
  return false;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(record: Record<string, unknown> | null, keys: ReadonlyArray<string>) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

export function toMobileProject(project: OrchestrationProjectShell): GraftProjectSummary {
  return {
    id: project.id,
    name: project.title,
    kind: project.kind === "project" ? "repo" : "desktop",
    path: project.workspaceRoot,
    updatedAt: timestamp(project.updatedAt),
  };
}

export function toMobileRuntimeMode(value: string | undefined): RuntimeMode {
  switch (value) {
    case "approval-required":
    case "ask":
    case "on-request":
    case "untrusted":
      return "approval-required";
    case "auto":
    case "on-failure":
      return "auto";
    case "full-access":
    case "never":
      return "full-access";
    default:
      return "approval-required";
  }
}

function toMobileThreadStatus(thread: OrchestrationThreadShell): GraftThreadStatus {
  if (thread.hasPendingApprovals === true || thread.hasPendingUserInput === true) {
    return "needs_attention";
  }
  if (
    thread.latestTurn?.state === "running" ||
    thread.session?.status === "starting" ||
    thread.session?.status === "running"
  ) {
    return "running";
  }
  return "idle";
}

function toMobilePr(thread: OrchestrationThreadShell): GraftThreadSummary["pr"] {
  const pullRequest = thread.lastKnownPr;
  if (!pullRequest) return undefined;
  const state = pullRequest.isDraft === true ? "draft" : pullRequest.state;
  return {
    number: pullRequest.number,
    state,
    ...(pullRequest.url ? { url: pullRequest.url } : {}),
  };
}

export function mobileThreadProviderLocked(thread: OrchestrationThreadShell): boolean {
  return Boolean(thread.latestTurn || thread.session || thread.latestUserMessageAt);
}

export function mobileThreadProvider(thread: OrchestrationThreadShell): ProviderKind {
  // The session is authoritative if an older client changed only the thread's
  // model metadata. That must not move an established chat to another provider.
  return (
    MOBILE_PROVIDER_ORDER.find((provider) => provider === thread.session?.providerName) ??
    thread.modelSelection.provider
  );
}

export function toMobileThread(thread: OrchestrationThreadShell): GraftThreadSummary {
  const pullRequest = toMobilePr(thread);
  const options = objectValue(thread.modelSelection.options);
  const effort = stringValue(options, ["reasoningEffort", "effort", "thinkingLevel", "variant"]);
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    updatedAt: timestamp(thread.updatedAt),
    status: toMobileThreadStatus(thread),
    ...(thread.latestTurn?.state === "completed" &&
    thread.latestTurn.completedAt &&
    thread.latestTurn.assistantMessageId
      ? { lastCompletedAt: timestamp(thread.latestTurn.completedAt) }
      : {}),
    modelName: thread.modelSelection.model,
    providerId: mobileThreadProvider(thread),
    providerLocked: mobileThreadProviderLocked(thread),
    ...(effort ? { effort } : {}),
    mode: thread.envMode,
    interactionMode: thread.interactionMode,
    fastMode: mobileFastMode(thread.modelSelection),
    approvalPolicy: thread.runtimeMode,
    approvalPolicyOptions: [...MOBILE_APPROVAL_POLICY_OPTIONS],
    ...(pullRequest ? { pr: pullRequest } : {}),
  };
}

function toMobileRunStatus(
  state: NonNullable<OrchestrationThreadShell["latestTurn"]>["state"],
  sessionStatus: OrchestrationSessionStatus | undefined,
  waiting: boolean,
): GraftRunStatus {
  if (waiting && state === "running") return "waiting";
  switch (state) {
    case "running":
      return sessionStatus === "starting" ? "queued" : "running";
    case "interrupted":
      return "cancelled";
    case "completed":
      return "completed";
    case "error":
      return "failed";
    default:
      return assertNeverMobile(state);
  }
}

export function toMobileRun(thread: OrchestrationThreadShell): GraftRunSummary | null {
  const turn = thread.latestTurn;
  if (!turn) return null;
  const waiting = thread.hasPendingApprovals === true || thread.hasPendingUserInput === true;
  return {
    id: turn.turnId,
    threadId: thread.id,
    projectId: thread.projectId,
    status: toMobileRunStatus(turn.state, thread.session?.status, waiting),
    startedAt: timestamp(turn.startedAt ?? turn.requestedAt),
    endedAt: turn.completedAt ? timestamp(turn.completedAt) : null,
    title: thread.title,
  };
}

function pendingActivity(
  thread: OrchestrationThread,
  requestId: string,
  kind: "approval.requested" | "user-input.requested",
): OrchestrationThreadActivity | undefined {
  return thread.activities.toReversed().find((activity) => {
    if (activity.kind !== kind) return false;
    return stringValue(objectValue(activity.payload), ["requestId"]) === requestId;
  });
}

export function toMobilePendingApprovals(thread: OrchestrationThread): GraftApprovalRequest[] {
  const approvals: GraftApprovalRequest[] = [];
  for (const interaction of thread.pendingInteractions ?? []) {
    if (
      interaction.interactionKind !== "approval" ||
      (interaction.status !== "pending" && interaction.status !== "retryable")
    ) {
      continue;
    }
    const activity = pendingActivity(thread, interaction.requestId, "approval.requested");
    const payload = objectValue(activity?.payload);
    const detail = stringValue(payload, ["detail", "command", "description"]);
    const toolName = stringValue(payload, ["toolName", "tool", "name"]);
    const requestKind = stringValue(payload, ["requestKind", "requestType"]);
    approvals.push({
      id: interaction.requestId,
      threadId: thread.id,
      ...(interaction.turnId ? { runId: interaction.turnId } : {}),
      title: requestKind ? `${requestKind.replaceAll("-", " ")} approval` : "Approval required",
      ...(detail ? { detail } : {}),
      ...(toolName ? { toolName } : {}),
      createdAt: timestamp(activity?.createdAt ?? interaction.createdAt),
    });
  }
  return approvals;
}

interface ParsedQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly options: ReadonlyArray<{ readonly id: string; readonly label: string }>;
}

function parseFirstQuestion(payload: Record<string, unknown> | null): ParsedQuestion | null {
  const questions = payload?.questions;
  if (!Array.isArray(questions)) return null;
  for (const value of questions) {
    const question = objectValue(value);
    if (!question) continue;
    const id = stringValue(question, ["id"]);
    const prompt = stringValue(question, ["question", "prompt", "header"]);
    if (!id || !prompt) continue;
    const options = Array.isArray(question.options)
      ? question.options.flatMap((option) => {
          const record = objectValue(option);
          const label = stringValue(record, ["label"]);
          return label ? [{ id: label, label }] : [];
        })
      : [];
    return { id, prompt, options };
  }
  return null;
}

export function toMobilePendingQuestions(thread: OrchestrationThread): GraftQuestionRequest[] {
  const questions: GraftQuestionRequest[] = [];
  for (const interaction of thread.pendingInteractions ?? []) {
    if (
      interaction.interactionKind !== "userInput" ||
      (interaction.status !== "pending" && interaction.status !== "retryable")
    ) {
      continue;
    }
    const activity = pendingActivity(thread, interaction.requestId, "user-input.requested");
    const question = parseFirstQuestion(objectValue(activity?.payload));
    questions.push({
      id: interaction.requestId,
      threadId: thread.id,
      ...(interaction.turnId ? { runId: interaction.turnId } : {}),
      prompt: question?.prompt ?? activity?.summary ?? "Input required",
      ...(question && question.options.length > 0 ? { options: [...question.options] } : {}),
      allowFreeform: true,
      createdAt: timestamp(activity?.createdAt ?? interaction.createdAt),
    });
  }
  return questions;
}

function activityEventKind(activity: OrchestrationThreadActivity): GraftTimelineEventKind {
  switch (activity.kind) {
    case "turn.tasks.updated":
      return "todo.update";
    case "approval.requested":
      return "approval.requested";
    case "approval.resolved":
      return "approval.resolved";
    case "user-input.requested":
      return "question.requested";
    case "user-input.resolved":
      return "question.resolved";
    case "tool.started":
      return "tool.start";
    case "tool.updated":
      return "tool.update";
    case "tool.completed":
      return "tool.end";
    case "turn.completed":
    case "turn.aborted":
      return "run.status";
    case "runtime.error":
    case "provider.error":
      return "error";
    case "reasoning.delta":
    case "thinking.delta":
      return "thinking.delta";
    default:
      return activity.tone === "error"
        ? "error"
        : activity.tone === "tool"
          ? "tool.update"
          : "status";
  }
}

function mobileTasks(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown> | null,
): GraftTimelineEventData | undefined {
  if (activity.kind !== "turn.tasks.updated" || !Array.isArray(payload?.tasks)) return undefined;
  const todos = payload.tasks.slice(0, 100).flatMap((value, index) => {
    const task = objectValue(value);
    const text = stringValue(task, ["task"]);
    if (!text) return [];
    const status =
      task?.status === "completed"
        ? ("completed" as const)
        : task?.status === "inProgress"
          ? ("in_progress" as const)
          : ("pending" as const);
    return [{ id: `${activity.turnId ?? "tasks"}:${index}`, text, status }];
  });
  // An explicit empty list clears tasks; a malformed update must not erase them.
  if (payload.tasks.length > 0 && todos.length === 0) return undefined;
  return { type: "todo_update", todos };
}

export function toMobileActivityEvent(
  threadId: string,
  activity: OrchestrationThreadActivity,
): GraftTimelineEvent {
  const payload = objectValue(activity.payload);
  const kind = activityEventKind(activity);
  const requestId = stringValue(payload, ["requestId"]);
  const toolData = objectValue(payload?.data);
  const toolItem = objectValue(toolData?.item);
  const toolName =
    stringValue(payload, ["toolName", "tool", "name"]) ??
    stringValue(toolData, ["toolName", "tool"]) ??
    stringValue(toolItem, ["toolName", "name"]) ??
    stringValue(payload, ["title"]);
  // Event IDs identify delivery; tool IDs correlate start/progress/completion,
  // using the same provider payload fields as desktop's work log.
  const toolId =
    stringValue(toolData, ["toolCallId", "toolUseId", "callID", "callId"]) ??
    stringValue(toolItem, ["id"]);
  const data = mobileTasks(activity, payload);
  return {
    id: activity.id,
    cursor: activity.sequence ?? 0,
    kind,
    threadId,
    ...(activity.turnId ? { runId: activity.turnId } : {}),
    createdAt: timestamp(activity.createdAt),
    text: activity.summary,
    ...(data ? { data } : {}),
    ...(toolName ? { toolName } : {}),
    ...(toolId && kind.startsWith("tool.") ? { toolId } : {}),
    ...(kind === "approval.requested" || kind === "approval.resolved"
      ? { approvalId: requestId ?? activity.id }
      : {}),
    ...(kind === "question.requested" || kind === "question.resolved"
      ? { questionId: requestId ?? activity.id }
      : {}),
    ...(kind === "run.status"
      ? { runStatus: activity.kind === "turn.completed" ? "completed" : "cancelled" }
      : {}),
  };
}

function checkpointFileStatus(kind: string): GraftDiffFileSummary["status"] {
  switch (kind.toLowerCase()) {
    case "added":
    case "add":
    case "created":
      return "added";
    case "deleted":
    case "delete":
    case "removed":
      return "deleted";
    case "renamed":
    case "rename":
      return "renamed";
    default:
      return "modified";
  }
}

function toMobileDiffFile(file: OrchestrationCheckpointFile): GraftDiffFileSummary {
  return {
    path: file.path,
    status: checkpointFileStatus(file.kind),
    additions: file.additions,
    deletions: file.deletions,
  };
}

export function toMobileDiff(
  threadId: string,
  checkpoint: OrchestrationCheckpointSummary | undefined,
): GraftDiffSummary {
  return {
    id: threadId,
    threadId,
    ...(checkpoint ? { runId: checkpoint.turnId } : {}),
    title: "Working changes",
    files: checkpoint?.files.map(toMobileDiffFile) ?? [],
    updatedAt: timestamp(checkpoint?.completedAt),
  };
}

export function toMobileTranscript(
  thread: OrchestrationThread,
  cursor: number,
): GraftTranscriptSnapshot {
  const messageEvents: GraftTimelineEvent[] = thread.messages.map((message) => {
    const messageCursor = message.textSegments?.at(-1)?.sequence ?? 0;
    const kind: GraftTimelineEventKind =
      message.role === "user"
        ? "user.message"
        : message.role === "assistant"
          ? message.streaming
            ? "assistant.delta"
            : "assistant.message"
          : "status";
    return {
      id: message.id,
      cursor: messageCursor,
      kind,
      threadId: thread.id,
      ...(message.turnId ? { runId: message.turnId } : {}),
      createdAt: timestamp(message.createdAt),
      ...(!message.streaming ? { completedAt: timestamp(message.updatedAt) } : {}),
      text: message.text,
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.filter(
              (attachment) => attachment.type === "image" || attachment.type === "file",
            ),
          }
        : {}),
      ...(message.role === "user" && message.skills?.length
        ? { skills: message.skills.map(({ name }) => ({ name })) }
        : {}),
    };
  });
  const activityEvents = thread.activities.map((activity) =>
    toMobileActivityEvent(thread.id, activity),
  );
  const diffEvents: GraftTimelineEvent[] = thread.checkpoints
    .filter((checkpoint) => checkpoint.files.length > 0)
    .map((checkpoint) => ({
      id: `diff:${thread.id}:${checkpoint.turnId}`,
      cursor: 0,
      kind: "diff.updated",
      threadId: thread.id,
      runId: checkpoint.turnId,
      createdAt: timestamp(checkpoint.completedAt),
      diffId: thread.id,
      text: `${checkpoint.files.length} changed ${checkpoint.files.length === 1 ? "file" : "files"}`,
    }));
  const events = [...messageEvents, ...activityEvents, ...diffEvents].toSorted(
    (left, right) =>
      left.createdAt - right.createdAt ||
      left.cursor - right.cursor ||
      left.id.localeCompare(right.id),
  );
  return { threadId: thread.id, events, cursor };
}

export function toMobileEnvironmentSummary(
  descriptor: ExecutionEnvironmentDescriptor,
  cursor: number,
  capabilities: GraftEnvironmentSummary["capabilities"],
): GraftEnvironmentSummary {
  return {
    id: descriptor.environmentId,
    label: descriptor.label,
    hostVersion: descriptor.serverVersion,
    protocolVersion: 1,
    capabilities,
    composerFeatures: { attachments: true, interactionModes: true, fastMode: true },
    cursor,
  };
}

export function toMobileSnapshot(input: {
  readonly descriptor: ExecutionEnvironmentDescriptor;
  readonly capabilities: GraftEnvironmentSummary["capabilities"];
  readonly cursor: number;
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
  readonly threads: ReadonlyArray<OrchestrationThreadShell>;
  readonly details: ReadonlyArray<OrchestrationThread>;
  readonly selectedThreadId?: string;
}): GraftEnvironmentSnapshot {
  const projects = withoutStudioProjects(input.projects);
  const threads = withoutStudioThreads(input.threads, input.projects).filter(
    (thread) => !thread.archivedAt,
  );
  const visibleThreadIds = new Set<string>(threads.map((thread) => thread.id));
  const details = withoutStudioThreads(input.details, input.projects).filter((thread) =>
    visibleThreadIds.has(thread.id),
  );
  const selected =
    input.selectedThreadId && visibleThreadIds.has(input.selectedThreadId)
      ? details.find((thread) => thread.id === input.selectedThreadId)
      : undefined;
  return {
    environment: toMobileEnvironmentSummary(input.descriptor, input.cursor, input.capabilities),
    projects: projects.map(toMobileProject),
    threads: threads.map((thread) => {
      const detail = details.find((candidate) => candidate.id === thread.id);
      const contextUsage = detail ? toMobileContextUsage(detail.activities) : undefined;
      return { ...toMobileThread(thread), ...(contextUsage ? { contextUsage } : {}) };
    }),
    activeRuns: threads
      .map(toMobileRun)
      .filter(
        (run): run is GraftRunSummary =>
          run !== null && ["queued", "running", "waiting"].includes(run.status),
      ),
    pendingApprovals: details.flatMap(toMobilePendingApprovals),
    pendingQuestions: details.flatMap(toMobilePendingQuestions),
    selectedTranscript: selected ? toMobileTranscript(selected, input.cursor) : null,
    cursor: input.cursor,
  };
}

interface StaticModelDefinition {
  readonly slug: string;
  readonly name: string;
  readonly capabilities: {
    readonly reasoningEffortLevels: ReadonlyArray<{
      readonly value: string;
      readonly isDefault?: boolean;
    }>;
    readonly supportsFastMode?: boolean;
  };
}

function dynamicEfforts(model: ProviderModelDescriptor): string[] {
  if (model.supportedReasoningEfforts && model.supportedReasoningEfforts.length > 0) {
    return model.supportedReasoningEfforts.map((effort) => effort.value);
  }
  const reasoning = model.optionDescriptors?.find((option) =>
    ["reasoningEffort", "effort", "thinkingLevel", "variant"].includes(option.id),
  );
  return reasoning?.type === "select" ? reasoning.options.map((option) => option.id) : [];
}

export function toMobileModels(input: {
  readonly enabledProviders: ReadonlySet<ProviderKind>;
  readonly discoveredModels: ReadonlyMap<ProviderKind, ReadonlyArray<ProviderModelDescriptor>>;
}): GraftModelOption[] {
  const models: GraftModelOption[] = [];
  for (const provider of MOBILE_PROVIDER_ORDER) {
    if (!input.enabledProviders.has(provider)) continue;
    const staticModels: ReadonlyArray<StaticModelDefinition> = MODEL_OPTIONS_BY_PROVIDER[provider];
    const merged = new Map<string, GraftModelOption>();
    for (const model of staticModels) {
      const reasoningEfforts = model.capabilities.reasoningEffortLevels.map(
        (effort) => effort.value,
      );
      const defaultReasoningEffort = model.capabilities.reasoningEffortLevels.find(
        (effort) => effort.isDefault,
      )?.value;
      merged.set(model.slug, {
        id: model.slug,
        label: model.name,
        supportsFastMode: model.capabilities.supportsFastMode ?? false,
        providerId: provider,
        providerLabel: PROVIDER_DISPLAY_NAMES[provider],
        ...(provider !== "pi" && DEFAULT_MODEL_BY_PROVIDER[provider] === model.slug
          ? { isDefault: true }
          : {}),
        ...(reasoningEfforts.length > 0 ? { reasoningEfforts } : {}),
        ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
        approvalPolicyOptions: [...MOBILE_APPROVAL_POLICY_OPTIONS],
        defaultApprovalPolicy: "approval-required",
      });
    }
    for (const model of input.discoveredModels.get(provider) ?? []) {
      const reasoningEfforts = dynamicEfforts(model);
      const previous = merged.get(model.slug);
      const defaultReasoningEffort =
        model.defaultReasoningEffort ?? previous?.defaultReasoningEffort;
      const supportsFastMode =
        model.supportsFastMode ??
        (model.optionDescriptors?.some(
          (option) => option.id === "fastMode" && option.type === "boolean",
        ) ||
          previous?.supportsFastMode === true);
      merged.set(model.slug, {
        id: model.slug,
        label: model.name,
        providerId: provider,
        providerLabel: PROVIDER_DISPLAY_NAMES[provider],
        ...(provider !== "pi" && DEFAULT_MODEL_BY_PROVIDER[provider] === model.slug
          ? { isDefault: true }
          : {}),
        ...(reasoningEfforts.length > 0
          ? { reasoningEfforts }
          : previous?.reasoningEfforts
            ? { reasoningEfforts: previous.reasoningEfforts }
            : {}),
        ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
        supportsFastMode,
        approvalPolicyOptions: [...MOBILE_APPROVAL_POLICY_OPTIONS],
        defaultApprovalPolicy: "approval-required",
      });
    }
    models.push(...merged.values());
  }
  return models;
}

export function defaultModelForProvider(provider: ProviderKind): string | null {
  return provider === "pi" ? null : DEFAULT_MODEL_BY_PROVIDER[provider];
}

export function withMobileEffort(
  selection: ModelSelection,
  effort: string | undefined,
): ModelSelection {
  if (!effort) return selection;
  switch (selection.provider) {
    case "codex":
      return { ...selection, options: { ...selection.options, reasoningEffort: effort } };
    case "claudeAgent":
      return ["low", "medium", "high", "xhigh", "max", "ultrathink", "ultracode"].includes(effort)
        ? {
            ...selection,
            options: {
              ...selection.options,
              effort: effort as NonNullable<typeof selection.options>["effort"],
            },
          }
        : selection;
    case "cursor":
      return { ...selection, options: { ...selection.options, reasoningEffort: effort } };
    case "devin":
      return { ...selection, options: { ...selection.options, reasoningEffort: effort } };
    case "antigravity":
      return { ...selection, options: { ...selection.options, reasoningEffort: effort } };
    case "grok":
      return ["none", "low", "medium", "high", "xhigh"].includes(effort)
        ? {
            ...selection,
            options: {
              ...selection.options,
              reasoningEffort: effort as NonNullable<typeof selection.options>["reasoningEffort"],
            },
          }
        : selection;
    case "droid":
      return { ...selection, options: { ...selection.options, reasoningEffort: effort } };
    case "opencode":
      return { ...selection, options: { ...selection.options, variant: effort } };
    case "pi":
      return ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(effort)
        ? {
            ...selection,
            options: {
              ...selection.options,
              thinkingLevel: effort as NonNullable<typeof selection.options>["thinkingLevel"],
            },
          }
        : selection;
    default:
      return assertNeverMobile(selection);
  }
}

export function mobileFastMode(selection: ModelSelection): boolean {
  const options = selection.options;
  return options !== undefined && "fastMode" in options && options.fastMode === true;
}

export function withMobileFastMode(
  selection: ModelSelection,
  fastMode: boolean | undefined,
): ModelSelection {
  if (fastMode === undefined) return selection;
  switch (selection.provider) {
    case "codex":
    case "claudeAgent":
    case "cursor":
    case "devin":
      return { ...selection, options: { ...selection.options, fastMode } };
    case "antigravity":
    case "grok":
    case "droid":
    case "opencode":
    case "pi":
      return selection;
    default:
      return assertNeverMobile(selection);
  }
}
