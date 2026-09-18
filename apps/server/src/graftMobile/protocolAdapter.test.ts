import {
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type ExecutionEnvironmentDescriptor,
  type OrchestrationEvent,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type OrchestrationThreadShell,
} from "@graft/contracts";
import { describe, expect, it } from "vitest";

import {
  makeGraftMobileLiveEventState,
  seedGraftMobileLiveEventState,
  toMobileLiveEvent,
} from "./liveEvents";
import {
  mobileThreadProviderLocked,
  mobileThreadProvider,
  toMobileActivityEvent,
  toMobileModels,
  toMobileProject,
  toMobileSnapshot,
  toMobileThread,
  toMobileTranscript,
  withoutStudioProjects,
  isHiddenStudioMobileEvent,
  rememberHiddenStudioFromEvent,
  rememberHiddenStudioFromShell,
  withMobileEffort,
  withMobileFastMode,
} from "./protocolAdapter";

describe("mobile provider lock", () => {
  it("keeps the established session provider when an old client changed model metadata", () => {
    const shell = threadShell();
    const mismatched = {
      ...shell,
      session: { ...shell.session!, providerName: "codex" },
    };
    expect(mobileThreadProvider(mismatched)).toBe("codex");
    expect(toMobileThread(mismatched).providerId).toBe("codex");
  });

  it("locks chats with turn, session, or message history even after a session stops", () => {
    const empty = { ...threadShell(), latestTurn: null, session: null, latestUserMessageAt: null };
    expect(mobileThreadProviderLocked(empty)).toBe(false);
    expect(toMobileThread(empty).providerLocked).toBe(false);
    for (const started of [
      { ...empty, latestTurn: threadShell().latestTurn },
      { ...empty, session: threadShell().session },
      { ...empty, latestUserMessageAt: now },
    ]) {
      expect(mobileThreadProviderLocked(started)).toBe(true);
      expect(toMobileThread(started).providerLocked).toBe(true);
    }
  });
});

const now = "2026-09-09T12:00:00.000Z";

function project(): OrchestrationProjectShell {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    kind: "project",
    title: "Graft Studio",
    workspaceRoot: "/workspace/graft-studio",
    defaultModelSelection: { provider: "claudeAgent", model: "claude-sonnet-5" },
    scripts: [],
    isPinned: false,
    spaceId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function threadShell(): OrchestrationThreadShell {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Mobile migration",
    modelSelection: { provider: "claudeAgent", model: "claude-sonnet-5" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    envMode: "local",
    branch: null,
    worktreePath: null,
    workingDirectory: null,
    associatedWorktreePath: null,
    associatedWorktreeBranch: null,
    associatedWorktreeRef: null,
    createBranchFlowCompleted: false,
    isPinned: false,
    parentThreadId: null,
    creationSource: null,
    sourceThreadId: null,
    sourceTurnId: null,
    gatewayOperationId: null,
    gatewayOperationIndex: null,
    subagentAgentId: null,
    subagentNickname: null,
    subagentRole: null,
    forkSourceThreadId: null,
    sidechatSourceThreadId: null,
    sidechatLastActivityAt: null,
    sidechatExpiredAt: null,
    lastKnownPr: null,
    latestTurn: {
      turnId: TurnId.makeUnsafe("turn-1"),
      state: "running",
      requestedAt: now,
      startedAt: now,
      completedAt: null,
      assistantMessageId: null,
    },
    latestUserMessageAt: now,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledAt: null,
    handoff: null,
    session: {
      threadId: ThreadId.makeUnsafe("thread-1"),
      status: "running",
      providerName: "Claude",
      runtimeMode: "approval-required",
      activeTurnId: TurnId.makeUnsafe("turn-1"),
      lastError: null,
      updatedAt: now,
    },
  };
}

function thread(): OrchestrationThread {
  return {
    ...threadShell(),
    deletedAt: null,
    messages: [
      {
        id: MessageId.makeUnsafe("message-user"),
        role: "user",
        text: "Use Claude",
        turnId: TurnId.makeUnsafe("turn-1"),
        streaming: false,
        source: "native",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: MessageId.makeUnsafe("message-assistant"),
        role: "assistant",
        text: "Working",
        textSegments: [{ sequence: 11, startedAt: now, endedAt: now, text: "Working" }],
        turnId: TurnId.makeUnsafe("turn-1"),
        streaming: true,
        source: "native",
        createdAt: now,
        updatedAt: now,
      },
    ],
    proposedPlans: [],
    activities: [],
    pendingInteractions: [],
    checkpoints: [],
  };
}

describe("Graft mobile protocol adapter", () => {
  it.each([
    { toolCallId: "call-1", toolName: "Read" },
    { toolUseId: "call-1", toolName: "Read" },
    { callID: "call-1", toolName: "Read" },
    { item: { id: "call-1", name: "Read" } },
  ])("preserves tool identity separately from delivery IDs: %j", (data) => {
    const events = ["tool.started", "tool.updated", "tool.completed"].map((kind, index) =>
      toMobileActivityEvent("thread-1", {
        id: EventId.makeUnsafe(`event-${index}`),
        sequence: index + 1,
        kind,
        tone: "tool",
        summary: "Reading",
        createdAt: now,
        turnId: TurnId.makeUnsafe("turn-1"),
        payload: { data },
      }),
    );
    expect(events.map((event) => event.id)).toEqual(["event-0", "event-1", "event-2"]);
    expect(events.map((event) => event.kind)).toEqual(["tool.start", "tool.update", "tool.end"]);
    expect(events.every((event) => event.toolId === "call-1" && event.toolName === "Read")).toBe(
      true,
    );
  });

  it("projects structured tasks identically in live events and reconnect snapshots", () => {
    const activity = {
      id: EventId.makeUnsafe("tasks-1"),
      kind: "turn.tasks.updated",
      tone: "tool" as const,
      summary: "1 of 3 tasks complete",
      turnId: TurnId.makeUnsafe("turn-1"),
      sequence: 20,
      createdAt: now,
      payload: {
        tasks: [
          { task: "Inspect the issue", status: "completed" },
          { task: "Apply the fix", status: "inProgress" },
          { task: "Verify on device", status: "pending" },
        ],
      },
    };
    const projected = toMobileActivityEvent("thread-1", activity);
    expect(projected).toMatchObject({
      kind: "todo.update",
      runId: "turn-1",
      data: {
        type: "todo_update",
        todos: [
          { id: "turn-1:0", text: "Inspect the issue", status: "completed" },
          { id: "turn-1:1", text: "Apply the fix", status: "in_progress" },
          { id: "turn-1:2", text: "Verify on device", status: "pending" },
        ],
      },
    });
    const snapshot = toMobileTranscript({ ...thread(), activities: [activity] }, 20);
    expect(snapshot.events.find((event) => event.id === activity.id)).toEqual(projected);
    const live = toMobileLiveEvent(makeGraftMobileLiveEventState(), {
      type: "thread.activity-appended",
      sequence: 20,
      eventId: activity.id,
      aggregateKind: "thread",
      aggregateId: ThreadId.makeUnsafe("thread-1"),
      occurredAt: now,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: { threadId: ThreadId.makeUnsafe("thread-1"), activity },
    });
    expect(live).toEqual(projected);
    const updated = toMobileActivityEvent("thread-1", {
      ...activity,
      id: EventId.makeUnsafe("tasks-2"),
      payload: {
        tasks: activity.payload.tasks.map((task) => ({ task: task.task, status: "completed" })),
      },
    });
    expect(
      updated.data?.type === "todo_update" && updated.data.todos.map((task) => task.id),
    ).toEqual(["turn-1:0", "turn-1:1", "turn-1:2"]);
  });

  it("distinguishes an explicit task clear from malformed task data", () => {
    const activity = {
      id: EventId.makeUnsafe("tasks"),
      kind: "turn.tasks.updated",
      tone: "tool" as const,
      summary: "Task update",
      turnId: null,
      createdAt: now,
    };
    expect(toMobileActivityEvent("thread-1", { ...activity, payload: { tasks: [] } }).data).toEqual(
      { type: "todo_update", todos: [] },
    );
    expect(
      toMobileActivityEvent("thread-1", { ...activity, payload: { tasks: [null, {}] } }).data,
    ).toBeUndefined();
    expect(
      toMobileActivityEvent("thread-1", { ...activity, payload: { tasks: "invalid" } }).data,
    ).toBeUndefined();
  });

  it("maps Graft project and thread identity without changing the mobile contract", () => {
    expect(toMobileProject(project())).toMatchObject({
      id: "project-1",
      name: "Graft Studio",
      kind: "repo",
    });
    expect(toMobileThread(threadShell())).toMatchObject({
      id: "thread-1",
      modelName: "claude-sonnet-5",
      providerId: "claudeAgent",
      status: "running",
      approvalPolicy: "approval-required",
    });
  });

  it("exposes enabled non-Codex providers and runtime-discovered models", () => {
    const models = toMobileModels({
      enabledProviders: new Set(["codex", "claudeAgent", "pi"]),
      discoveredModels: new Map([
        [
          "pi",
          [
            {
              slug: "anthropic/claude-sonnet-5",
              name: "Claude Sonnet 5 through Pi",
              supportedReasoningEfforts: [{ value: "high" }],
            },
          ],
        ],
      ]),
    });
    expect(models.some((model) => model.providerId === "claudeAgent")).toBe(true);
    expect(models).toContainEqual(
      expect.objectContaining({
        id: "anthropic/claude-sonnet-5",
        providerId: "pi",
        reasoningEfforts: ["high"],
      }),
    );
    expect(models.some((model) => model.providerId === "cursor")).toBe(false);
  });

  it("preserves provider-specific reasoning controls", () => {
    expect(
      withMobileEffort({ provider: "claudeAgent", model: "claude-sonnet-5" }, "xhigh"),
    ).toMatchObject({ options: { effort: "xhigh" } });
    expect(withMobileEffort({ provider: "pi", model: "openai/gpt-5" }, "high")).toMatchObject({
      options: { thinkingLevel: "high" },
    });
  });

  it("projects desktop intelligence and speed and advertises model capabilities", () => {
    const thread: OrchestrationThreadShell = {
      ...threadShell(),
      modelSelection: {
        provider: "codex",
        model: "gpt-5.5",
        options: { reasoningEffort: "max", fastMode: true },
      },
    };
    expect(toMobileThread(thread)).toMatchObject({ effort: "max", fastMode: true });
    const models = toMobileModels({
      enabledProviders: new Set(["codex", "pi"]),
      discoveredModels: new Map(),
    });
    expect(models.find((model) => model.id === "gpt-5.5")).toMatchObject({
      supportsFastMode: true,
      defaultReasoningEffort: expect.any(String),
    });
    expect(
      models.filter((model) => model.providerId === "pi").every((model) => !model.supportsFastMode),
    ).toBe(true);
  });

  it("does not add a speed option to providers that do not support it", () => {
    expect(
      withMobileFastMode(
        { provider: "pi", model: "test", options: { thinkingLevel: "high" } },
        true,
      ),
    ).toEqual({ provider: "pi", model: "test", options: { thinkingLevel: "high" } });
    expect(
      withMobileFastMode(
        {
          provider: "codex",
          model: "gpt-5.5",
          options: { reasoningEffort: "high", fastMode: true },
        },
        false,
      ),
    ).toMatchObject({ options: { reasoningEffort: "high", fastMode: false } });
  });

  it("builds an authoritative snapshot and selected transcript", () => {
    const descriptor: ExecutionEnvironmentDescriptor = {
      environmentId: EnvironmentId.makeUnsafe("environment-1"),
      label: "Brent's Mac",
      platform: { os: "darwin", arch: "arm64" },
      serverVersion: "0.8.1",
      capabilities: { repositoryIdentity: true },
    };
    const snapshot = toMobileSnapshot({
      descriptor,
      capabilities: ["projects", "threads", "models"],
      cursor: 12,
      projects: [project()],
      threads: [threadShell()],
      details: [thread()],
      selectedThreadId: "thread-1",
    });
    expect(snapshot.activeRuns).toEqual([
      expect.objectContaining({ id: "turn-1", status: "running" }),
    ]);
    expect(snapshot.selectedTranscript).toEqual(
      expect.objectContaining({
        threadId: "thread-1",
        cursor: 12,
        events: expect.arrayContaining([
          expect.objectContaining({ kind: "assistant.delta", text: "Working", cursor: 11 }),
        ]),
      }),
    );
    expect(toMobileTranscript(thread(), 12).events).toHaveLength(2);
  });

  it("omits studio-kind projects and their threads from mobile lists", () => {
    const studio = {
      ...project(),
      id: ProjectId.makeUnsafe("studio-1"),
      kind: "studio" as const,
      title: "Studio",
    };
    const studioThread = {
      ...threadShell(),
      id: ThreadId.makeUnsafe("studio-thread"),
      projectId: studio.id,
    };
    expect(withoutStudioProjects([project(), studio]).map((entry) => entry.id)).toEqual([
      "project-1",
    ]);
    const snapshot = toMobileSnapshot({
      descriptor: {
        environmentId: EnvironmentId.makeUnsafe("environment-1"),
        label: "Brent's Mac",
        platform: { os: "darwin", arch: "arm64" },
        serverVersion: "0.8.1",
        capabilities: { repositoryIdentity: true },
      },
      capabilities: ["projects", "threads"],
      cursor: 1,
      projects: [project(), studio],
      threads: [threadShell(), studioThread],
      details: [],
      selectedThreadId: "studio-thread",
    });
    expect(snapshot.projects.map((entry) => entry.id)).toEqual(["project-1"]);
    expect(snapshot.threads.map((entry) => entry.id)).toEqual(["thread-1"]);
    expect(snapshot.selectedTranscript).toBeNull();
  });

  it("hides live Studio events so reconnect snapshots and the stream share one thread set", () => {
    const studio = {
      ...project(),
      id: ProjectId.makeUnsafe("studio-1"),
      kind: "studio" as const,
    };
    const hidden = { studioProjectIds: new Set<string>(), studioThreadIds: new Set<string>() };
    rememberHiddenStudioFromShell(
      [project(), studio],
      [
        threadShell(),
        { ...threadShell(), id: ThreadId.makeUnsafe("studio-thread"), projectId: studio.id },
      ],
      hidden,
    );
    const studioMessage: OrchestrationEvent = {
      sequence: 9,
      eventId: EventId.makeUnsafe("studio-delta"),
      aggregateKind: "thread",
      aggregateId: ThreadId.makeUnsafe("studio-thread"),
      occurredAt: now,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "thread.message-sent",
      payload: {
        threadId: ThreadId.makeUnsafe("studio-thread"),
        messageId: MessageId.makeUnsafe("studio-message"),
        role: "assistant",
        text: "secret studio reply",
        turnId: null,
        streaming: true,
        source: "native",
        createdAt: now,
        updatedAt: now,
      },
    };
    expect(isHiddenStudioMobileEvent(studioMessage, hidden)).toBe(true);
    expect(
      isHiddenStudioMobileEvent(
        {
          ...studioMessage,
          aggregateId: ThreadId.makeUnsafe("thread-1"),
          payload: { ...studioMessage.payload, threadId: ThreadId.makeUnsafe("thread-1") },
        },
        hidden,
      ),
    ).toBe(false);

    const created: OrchestrationEvent = {
      sequence: 10,
      eventId: EventId.makeUnsafe("studio-project-created"),
      aggregateKind: "project",
      aggregateId: ProjectId.makeUnsafe("studio-2"),
      occurredAt: now,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId: ProjectId.makeUnsafe("studio-2"),
        kind: "studio",
        title: "Studio",
        workspaceRoot: "/workspace/studio",
        defaultModelSelection: null,
        scripts: [],
        isPinned: false,
        spaceId: null,
        createdAt: now,
        updatedAt: now,
      },
    };
    rememberHiddenStudioFromEvent(created, hidden);
    expect(isHiddenStudioMobileEvent(created, hidden)).toBe(true);
    expect(hidden.studioProjectIds.has("studio-2")).toBe(true);
  });

  it("carries the same completion time as desktop into transcript snapshots", () => {
    const source = thread();
    const endedAt = "2026-09-15T08:00:12.000Z";
    const messages = source.messages.map((message) => ({
      ...message,
      streaming: false,
      updatedAt: endedAt,
    }));
    const transcript = toMobileTranscript({ ...source, messages }, 22);
    const reply = transcript.events.find((event) => event.kind === "assistant.message");
    expect(reply?.completedAt).toBe(Date.parse(endedAt));
  });

  it("preserves skill identity in user history and live echoes without exposing host paths", () => {
    const source = thread();
    const user = source.messages[0]!;
    const skillMessage = {
      ...user,
      role: "user" as const,
      text: "/swiftui-specialist Fix chat",
      skills: [{ name: "swiftui-specialist", path: "/private/skills/swiftui-specialist/SKILL.md" }],
    };
    const history = toMobileTranscript({ ...source, messages: [skillMessage] }, 20).events[0];
    const event: OrchestrationEvent = {
      sequence: 20,
      eventId: EventId.makeUnsafe("user-skill"),
      aggregateKind: "thread",
      aggregateId: source.id,
      occurredAt: now,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "thread.message-sent",
      payload: { ...skillMessage, threadId: source.id, messageId: skillMessage.id },
    };
    const live = toMobileLiveEvent(makeGraftMobileLiveEventState(), event);
    for (const projected of [history, live]) {
      expect(projected).toMatchObject({
        kind: "user.message",
        text: skillMessage.text,
        skills: [{ name: "swiftui-specialist" }],
      });
      expect(JSON.stringify(projected)).not.toContain("/private/skills");
    }
  });

  it("turns Graft assistant deltas into cumulative mobile frames", () => {
    const state = makeGraftMobileLiveEventState();
    const event = (sequence: number, text: string, streaming = true): OrchestrationEvent => ({
      sequence,
      eventId: EventId.makeUnsafe(`event-${sequence}`),
      aggregateKind: "thread",
      aggregateId: ThreadId.makeUnsafe("thread-1"),
      occurredAt: now,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "thread.message-sent",
      payload: {
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: MessageId.makeUnsafe("message-assistant"),
        role: "assistant",
        text,
        turnId: TurnId.makeUnsafe("turn-1"),
        streaming,
        source: "native",
        createdAt: now,
        updatedAt: now,
      },
    });
    const resumed = makeGraftMobileLiveEventState();
    seedGraftMobileLiveEventState(resumed, {
      snapshotSequence: 1,
      thread: {
        ...thread(),
        messages: [
          {
            ...thread().messages[1]!,
            id: MessageId.makeUnsafe("message-assistant"),
            role: "assistant",
            text: "Hello",
            streaming: true,
          },
        ],
      },
    });
    expect(toMobileLiveEvent(resumed, event(1, "Hello"))).toBeNull();
    expect(toMobileLiveEvent(resumed, event(2, " world"))).toMatchObject({ text: "Hello world" });
    expect(toMobileLiveEvent(resumed, event(3, "", false))).toMatchObject({
      kind: "assistant.message",
      text: "Hello world",
    });

    expect(toMobileLiveEvent(state, event(1, "Hello"))).toMatchObject({
      kind: "assistant.delta",
      text: "Hello",
    });
    expect(toMobileLiveEvent(state, event(2, " world"))).toMatchObject({
      kind: "assistant.delta",
      text: "Hello world",
    });
    expect(toMobileLiveEvent(state, event(3, "", false))).toMatchObject({
      kind: "assistant.message",
      completedAt: Date.parse(now),
      text: "Hello world",
    });

    const reconnect = makeGraftMobileLiveEventState();
    seedGraftMobileLiveEventState(reconnect, { thread: thread(), snapshotSequence: 11 });
    expect(toMobileLiveEvent(reconnect, event(11, "Working"))).toBeNull();
    expect(toMobileLiveEvent(reconnect, event(12, " again"))).toMatchObject({
      text: "Working again",
    });
    expect(toMobileLiveEvent(reconnect, event(13, "", false))).toMatchObject({
      kind: "assistant.message",
      text: "Working again",
    });
  });

  it("settles a ready provider session without an active turn", () => {
    const session = threadShell().session!;
    const event: OrchestrationEvent = {
      sequence: 20,
      eventId: EventId.makeUnsafe("ready"),
      aggregateKind: "thread",
      aggregateId: session.threadId,
      occurredAt: now,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "thread.session-set",
      payload: {
        threadId: session.threadId,
        session: { ...session, status: "ready", activeTurnId: null },
      },
    };
    expect(toMobileLiveEvent(makeGraftMobileLiveEventState(), event)).toMatchObject({
      kind: "run.status",
      runStatus: "completed",
    });
  });
});

it("projects user attachment metadata in snapshots and live events", () => {
  const source = thread();
  const attachment = {
    id: "upload-1",
    type: "image" as const,
    name: "photo.png",
    mimeType: "image/png",
    sizeBytes: 42,
  };
  const user = { ...source.messages[0]!, text: "", attachments: [attachment] };
  expect(toMobileTranscript({ ...source, messages: [user] }, 12).events[0]).toMatchObject({
    text: "",
    attachments: [attachment],
  });
  const event: OrchestrationEvent = {
    sequence: 12,
    eventId: EventId.makeUnsafe("event-file"),
    aggregateKind: "thread",
    aggregateId: source.id,
    occurredAt: now,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.message-sent",
    payload: { ...user, messageId: user.id, threadId: source.id },
  };
  expect(toMobileLiveEvent(makeGraftMobileLiveEventState(), event)).toMatchObject({
    kind: "user.message",
    text: "",
    attachments: [attachment],
  });
});
