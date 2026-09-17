import type { OrchestrationCommand } from "@graft/contracts";

export const LEGACY_GRAFT_READ_ONLY_MESSAGE =
  "This conversation was imported from the previous Graft app. Its history is read-only. Start a new chat in this project to continue working.";

export function isLegacyGraftThread(threadId: string | null | undefined): boolean {
  return threadId?.startsWith("legacy-graft:thread:") ?? false;
}

const ALLOWED_COMMANDS = new Set<OrchestrationCommand["type"]>([
  "thread.create",
  "thread.messages.import",
  "thread.activity.append",
  "thread.archive",
  "thread.unarchive",
  "thread.delete",
  "thread.pinned-message.add",
  "thread.pinned-message.remove",
  "thread.pinned-message.done.set",
  "thread.pinned-message.label.set",
  "thread.session.stop",
  "thread.turn.interrupt",
  "thread.task.stop",
]);
const PASSIVE_METADATA = new Set([
  "type",
  "commandId",
  "threadId",
  "title",
  "expectedTitleSequence",
  "isPinned",
  "isSettled",
  "pinnedMessages",
  "notes",
]);

// The namespace is permanent, so deleting an import marker or restarting cannot
// accidentally make an old provider session executable. New commands fail closed.
export function legacyGraftCommandBlockedReason(command: OrchestrationCommand): string | null {
  if ("sourceThreadId" in command && isLegacyGraftThread(command.sourceThreadId)) {
    return LEGACY_GRAFT_READ_ONLY_MESSAGE;
  }
  if (!("threadId" in command) || !isLegacyGraftThread(command.threadId)) return null;
  // Archive/stop reactors must be able to settle the imported row without
  // creating an active provider session or a goal that cannot be continued.
  if (command.type === "thread.session.set") {
    return command.session.status === "stopped" && command.session.activeTurnId === null
      ? null
      : LEGACY_GRAFT_READ_ONLY_MESSAGE;
  }
  if (command.type === "thread.meta.update") {
    return Object.entries(command).every(
      ([key, value]) =>
        value === undefined ||
        PASSIVE_METADATA.has(key) ||
        (key === "goalPaused" && value === true),
    )
      ? null
      : LEGACY_GRAFT_READ_ONLY_MESSAGE;
  }
  return ALLOWED_COMMANDS.has(command.type) ? null : LEGACY_GRAFT_READ_ONLY_MESSAGE;
}
