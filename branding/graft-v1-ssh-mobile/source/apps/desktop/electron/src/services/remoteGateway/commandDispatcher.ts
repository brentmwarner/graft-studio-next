import {
  DEFAULT_MOBILE_CAPABILITIES,
  GRAFT_MOBILE_PROTOCOL_VERSION,
  GraftMobileCommandSchema,
  type GraftCommandId,
  type GraftCommandReceipt,
  type GraftMobileCommand,
  type GraftMobileCommandResult,
} from "@graft/shared";
import type { EventJournal } from "./eventJournal.js";
import type { RemoteGatewayHandlers } from "./types.js";

type CachedReceipt = {
  receipt: GraftCommandReceipt;
  result?: GraftMobileCommandResult;
};

export type CommandDispatcher = {
  dispatch: (input: {
    commandId: GraftCommandId;
    requestId?: string;
    command: GraftMobileCommand;
  }) => Promise<{
    receipt: GraftCommandReceipt;
    result?: GraftMobileCommandResult;
  }>;
};

export function createCommandDispatcher(input: {
  handlers: RemoteGatewayHandlers;
  journal: EventJournal;
  environment?: { id: string; label: string };
}): CommandDispatcher {
  const cache = new Map<GraftCommandId, CachedReceipt>();
  const inflight = new Map<GraftCommandId, Promise<CachedReceipt>>();

  return {
    async dispatch({ commandId, requestId, command }) {
      const parsed = GraftMobileCommandSchema.safeParse(command);
      if (!parsed.success) {
        const receipt: GraftCommandReceipt = {
          commandId,
          requestId,
          status: "rejected",
          errorCode: "validation_failed",
          message: "invalid_command",
        };
        return { receipt };
      }

      const cached = cache.get(commandId);
      if (cached) {
        return {
          receipt: { ...cached.receipt, status: "duplicate" },
          result: cached.result,
        };
      }

      const pending = inflight.get(commandId);
      if (pending) {
        const settled = await pending;
        return {
          receipt: { ...settled.receipt, status: "duplicate" },
          result: settled.result,
        };
      }

      const work = (async (): Promise<CachedReceipt> => {
        try {
          const result = await executeCommand(parsed.data, {
            ...input,
            commandId,
          });
          const receipt: GraftCommandReceipt = {
            commandId,
            requestId,
            status: "accepted",
            runId:
              result?.type === "turn.start.result" ? result.run.id : undefined,
            cursor: input.journal.latestCursor(),
          };
          const entry = { receipt, result };
          cache.set(commandId, entry);
          return entry;
        } catch (error) {
          const receipt: GraftCommandReceipt = {
            commandId,
            requestId,
            status: "rejected",
            errorCode: "internal",
            message: error instanceof Error ? error.message : "command_failed",
          };
          const entry = { receipt };
          cache.set(commandId, entry);
          return entry;
        } finally {
          inflight.delete(commandId);
        }
      })();

      inflight.set(commandId, work);
      const settled = await work;
      return { receipt: settled.receipt, result: settled.result };
    },
  };
}

async function executeCommand(
  command: GraftMobileCommand,
  input: {
    handlers: RemoteGatewayHandlers;
    journal: EventJournal;
    commandId: GraftCommandId;
    environment?: { id: string; label: string };
  },
): Promise<GraftMobileCommandResult | undefined> {
  switch (command.type) {
    case "project.list": {
      const projects = await input.handlers.listProjects();
      return { type: "project.list.result", projects };
    }
    case "thread.list": {
      const threads = await input.handlers.listThreads(command.projectId);
      return { type: "thread.list.result", threads };
    }
    case "thread.open": {
      const opened = await input.handlers.openThread(command.threadId);
      return {
        type: "thread.open.result",
        transcript: {
          ...opened.transcript,
          cursor: input.journal.latestCursor(),
        },
        run: opened.run,
        pendingApprovals: opened.pendingApprovals,
        pendingQuestions: opened.pendingQuestions,
      };
    }
    case "thread.create": {
      const thread = await input.handlers.createThread({
        projectId: command.projectId,
        title: command.title,
        mode: command.mode,
        modelId: command.modelId,
        providerId: command.providerId,
        approvalPolicy: command.approvalPolicy,
      });
      return { type: "thread.create.result", thread };
    }
    case "thread.set_model": {
      const thread = await input.handlers.setThreadModel({
        threadId: command.threadId,
        modelId: command.modelId,
        providerId: command.providerId,
      });
      return { type: "thread.set_model.result", thread };
    }
    case "thread.set_approval": {
      const thread = await input.handlers.setThreadApproval({
        threadId: command.threadId,
        approvalPolicy: command.approvalPolicy,
      });
      return { type: "thread.set_approval.result", thread };
    }
    case "models.list": {
      const models = await input.handlers.listModels();
      return { type: "models.list.result", models };
    }
    case "turn.start": {
      const { runId } = await input.handlers.startTurn({
        threadId: command.threadId,
        text: command.text,
        commandId: input.commandId,
        ...(command.effort ? { effort: command.effort } : {}),
      });
      const run = {
        id: runId,
        threadId: command.threadId,
        status: "running" as const,
        startedAt: Date.now(),
      };
      input.journal.append({
        id: `evt-${runId}-user`,
        kind: "user.message",
        threadId: command.threadId,
        runId,
        createdAt: Date.now(),
        text: command.text,
      });
      return { type: "turn.start.result", run };
    }
    case "turn.cancel": {
      await input.handlers.cancelTurn({
        runId: command.runId,
        commandId: input.commandId,
      });
      return { type: "turn.cancel.result", runId: command.runId };
    }
    case "turn.steer": {
      const steered = await input.handlers.steerTurn({
        runId: command.runId,
        text: command.text,
        commandId: input.commandId,
      });
      return { type: "turn.steer.result", runId: steered.runId };
    }
    case "approval.resolve": {
      await input.handlers.resolveApproval({
        approvalId: command.approvalId,
        decision: command.decision,
      });
      return {
        type: "approval.resolve.result",
        approvalId: command.approvalId,
        decision: command.decision,
      };
    }
    case "question.resolve": {
      await input.handlers.resolveQuestion({
        questionId: command.questionId,
        optionId: command.optionId,
        text: command.text,
      });
      return {
        type: "question.resolve.result",
        questionId: command.questionId,
      };
    }
    case "diff.get": {
      const diff = await input.handlers.getDiff(command.diffId);
      return { type: "diff.get.result", diff };
    }
    case "cursor.replay": {
      const replay = input.journal.replayAfter(command.afterCursor);
      return {
        type: "cursor.replay.result",
        replay: { afterCursor: command.afterCursor, ...replay },
      };
    }
    case "snapshot.get": {
      const projects = await input.handlers.listProjects();
      const threads = await input.handlers.listThreads();
      const activeRuns = await input.handlers.listActiveRuns();
      const pendingApprovals = await input.handlers.listPendingApprovals(
        command.threadId,
      );
      const pendingQuestions = await input.handlers.listPendingQuestions(
        command.threadId,
      );
      const selectedTranscript = command.threadId
        ? (await input.handlers.openThread(command.threadId)).transcript
        : null;
      return {
        type: "snapshot.get.result",
        snapshot: {
          environment: {
            id: input.environment?.id ?? "local-studio",
            label: input.environment?.label ?? "Graft Studio",
            protocolVersion: GRAFT_MOBILE_PROTOCOL_VERSION,
            capabilities: [...DEFAULT_MOBILE_CAPABILITIES],
            cursor: input.journal.latestCursor(),
          },
          projects,
          threads,
          activeRuns,
          pendingApprovals,
          pendingQuestions,
          selectedTranscript: selectedTranscript
            ? {
                ...selectedTranscript,
                cursor: input.journal.latestCursor(),
              }
            : null,
          cursor: input.journal.latestCursor(),
        },
      };
    }
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
}
