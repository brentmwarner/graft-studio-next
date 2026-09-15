import type { GraftRunStatus, GraftTimelineEvent } from "@graft/mobile-contract";
import type { OrchestrationEvent, OrchestrationSessionStatus } from "@graft/contracts";

import { toMobileActivityEvent } from "./protocolAdapter";

export interface GraftMobileLiveEventState {
  readonly assistantTextByMessageId: Map<string, string>;
}

export function makeGraftMobileLiveEventState(): GraftMobileLiveEventState {
  return { assistantTextByMessageId: new Map() };
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function runStatusFromSession(status: OrchestrationSessionStatus): GraftRunStatus {
  if (status === "starting") return "queued";
  if (status === "running" || status === "ready") return "running";
  if (status === "interrupted" || status === "stopped") return "cancelled";
  if (status === "error") return "failed";
  return "completed";
}

export function toMobileLiveEvent(
  state: GraftMobileLiveEventState,
  event: OrchestrationEvent,
): GraftTimelineEvent | null {
  if (event.aggregateKind !== "thread") return null;
  const threadId = String(event.aggregateId);
  const base = {
    id: event.eventId,
    cursor: event.sequence,
    threadId,
    createdAt: timestamp(event.occurredAt),
  } as const;

  if (event.type === "thread.message-sent") {
    const payload = event.payload;
    if (payload.role === "assistant") {
      const previous = state.assistantTextByMessageId.get(payload.messageId) ?? "";
      const text = payload.streaming ? `${previous}${payload.text}` : payload.text || previous;
      if (payload.streaming) state.assistantTextByMessageId.set(payload.messageId, text);
      else state.assistantTextByMessageId.delete(payload.messageId);
      return {
        ...base,
        id: payload.messageId,
        kind: payload.streaming ? "assistant.delta" : "assistant.message",
        ...(payload.turnId ? { runId: payload.turnId } : {}),
        text,
      };
    }
    return {
      ...base,
      id: payload.messageId,
      kind: payload.role === "user" ? "user.message" : "status",
      ...(payload.turnId ? { runId: payload.turnId } : {}),
      text: payload.text,
    };
  }

  if (event.type === "thread.activity-appended") {
    return {
      ...toMobileActivityEvent(threadId, event.payload.activity),
      cursor: event.sequence,
    };
  }

  if (event.type === "thread.session-set") {
    const session = event.payload.session;
    return {
      ...base,
      kind: "run.status",
      ...(session.activeTurnId ? { runId: session.activeTurnId } : {}),
      runStatus: runStatusFromSession(session.status),
      ...(session.lastError ? { text: session.lastError } : {}),
    };
  }

  if (event.type === "thread.turn-diff-completed") {
    return {
      ...base,
      kind: "diff.updated",
      runId: event.payload.turnId,
      diffId: threadId,
      text: `${event.payload.files.length} changed ${event.payload.files.length === 1 ? "file" : "files"}`,
    };
  }

  if (event.type === "thread.approval-response-requested") {
    return {
      ...base,
      kind: "approval.resolved",
      approvalId: event.payload.requestId,
      text: event.payload.decision,
    };
  }

  if (event.type === "thread.user-input-response-requested") {
    return {
      ...base,
      kind: "question.resolved",
      questionId: event.payload.requestId,
    };
  }

  if (event.type === "thread.turn-interrupt-requested") {
    return {
      ...base,
      kind: "run.status",
      ...(event.payload.turnId ? { runId: event.payload.turnId } : {}),
      runStatus: "cancelled",
    };
  }

  if (event.type === "thread.turn-start-requested" || event.type === "thread.turn-queued") {
    return {
      ...base,
      kind: "run.status",
      ...(event.commandId ? { runId: event.commandId } : {}),
      runStatus: event.type === "thread.turn-queued" ? "queued" : "running",
    };
  }

  return {
    ...base,
    kind: "status",
  };
}
