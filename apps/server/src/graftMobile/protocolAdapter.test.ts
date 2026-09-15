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
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { makeGraftMobileLiveEventState, seedGraftMobileLiveEventState, toMobileLiveEvent } from "./liveEvents";
import {
  toMobileModels,
  toMobileProject,
  toMobileSnapshot,
  toMobileThread,
  toMobileTranscript,
  withMobileEffort,
} from "./protocolAdapter";

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
  it("maps Synara project and thread identity without changing the mobile contract", () => {
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

  it("turns Synara assistant deltas into cumulative mobile frames", () => {
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
      thread: { ...thread(), messages: [{
        ...thread().messages[1]!, id: MessageId.makeUnsafe("message-assistant"),
        role: "assistant", text: "Hello", streaming: true,
      }] },
    });
    expect(toMobileLiveEvent(resumed, event(1, "Hello"))).toBeNull();
    expect(toMobileLiveEvent(resumed, event(2, " world"))).toMatchObject({ text: "Hello world" });
    expect(toMobileLiveEvent(resumed, event(3, "", false))).toMatchObject({ kind: "assistant.message", text: "Hello world" });

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
      text: "Hello world",
    });
  });
});
