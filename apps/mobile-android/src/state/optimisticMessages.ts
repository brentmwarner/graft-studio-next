import type { GraftTimelineEvent } from "@graft/mobile-contract";

/** Local-only boundary: a new send must never match an older identical prompt. */
export type LocalTimelineEvent = GraftTimelineEvent & {
  /** null is known-empty history; undefined means the transcript has not loaded. */
  readonly optimisticAfterMessageId?: string | null;
  readonly optimisticAfterCursor?: number;
};

function messageSignature(event: GraftTimelineEvent): string {
  return JSON.stringify([
    event.threadId,
    event.text?.trim() ?? "",
    event.attachments?.map(({ name, sizeBytes, type }) => [name, sizeBytes, type]) ?? [],
  ]);
}

export function reconciledOptimisticMessageIds(
  settled: readonly GraftTimelineEvent[],
  live: readonly LocalTimelineEvent[],
): ReadonlyMap<string, string> {
  const localMessages = live.filter((event) => event.kind === "user.message" && event.cursor === 0);
  if (!localMessages.length) return new Map();
  // Snapshot event cursors are synthetic. Match messages across the whole
  // history by identity/content, never by the snapshot's journal cursor.
  const authoritative = new Map<string, GraftTimelineEvent>();
  const liveCursors = new Map<string, number>();
  for (const event of settled) {
    if (event.kind === "user.message") authoritative.set(event.id, event);
  }
  for (const event of live) {
    if (event.kind === "user.message" && event.cursor > 0) {
      authoritative.set(event.id, event);
      liveCursors.set(event.id, event.cursor);
    }
  }
  const messages = [...authoritative.values()];
  const positions = new Map(messages.map((event, index) => [event.id, index]));
  const signatures = messages.map(messageSignature);
  const consumed = new Set<number>();
  const reconciled = new Map<string, string>();

  for (const local of localMessages) {
    const anchor = local.optimisticAfterMessageId;
    // Unknown history cannot match snapshot content: an identical old prompt
    // may arrive in the first snapshot after this send. Only a new live echo
    // can establish its boundary without a message ID from the command result.
    const boundary =
      anchor === null ? -1 : anchor === undefined ? undefined : positions.get(anchor);
    const signature = messageSignature(local);
    const index = messages.findIndex((message, position) => {
      if (consumed.has(position)) return false;
      if (message.id === local.id) return true;
      const afterBoundary =
        anchor === undefined
          ? local.optimisticAfterCursor !== undefined &&
            (liveCursors.get(message.id) ?? 0) > local.optimisticAfterCursor
          : boundary !== undefined && position > boundary;
      return afterBoundary && signatures[position] === signature;
    });
    if (index < 0) continue;
    consumed.add(index);
    reconciled.set(local.id, messages[index]!.id);
    // A second send can be anchored to a still-local first send.
    positions.set(local.id, index);
  }
  return reconciled;
}

/** Retire acknowledged echoes so a later truncated snapshot cannot resurrect them. */
export function reconcileLiveUserMessages(
  settled: readonly GraftTimelineEvent[],
  live: readonly LocalTimelineEvent[],
): readonly LocalTimelineEvent[] {
  const reconciled = reconciledOptimisticMessageIds(settled, live);
  if (!reconciled.size) return live;
  const remaining: LocalTimelineEvent[] = [];
  for (const event of live) {
    if (event.cursor === 0 && reconciled.has(event.id)) continue;
    const anchor = event.optimisticAfterMessageId;
    const replacement = anchor ? reconciled.get(anchor) : undefined;
    remaining.push(replacement ? { ...event, optimisticAfterMessageId: replacement } : event);
  }
  return remaining;
}
