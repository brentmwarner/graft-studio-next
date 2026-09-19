import type { GraftTimelineEvent } from "@graft/mobile-contract";

/** Local-only boundary: a new send must never match an older identical prompt. */
export type LocalTimelineEvent = GraftTimelineEvent & {
  readonly optimisticAfterMessageId?: string | null;
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
  for (const event of settled) {
    if (event.kind === "user.message") authoritative.set(event.id, event);
  }
  for (const event of live) {
    if (event.kind === "user.message" && event.cursor > 0) authoritative.set(event.id, event);
  }
  const messages = [...authoritative.values()];
  const positions = new Map(messages.map((event, index) => [event.id, index]));
  const signatures = messages.map(messageSignature);
  const consumed = new Set<number>();
  const reconciled = new Map<string, string>();

  for (const local of localMessages) {
    const anchor = local.optimisticAfterMessageId;
    // A missing anchor may be an earlier pending send or outside the loaded
    // transcript. Keep the local row until there is evidence of its echo.
    const boundary = anchor ? positions.get(anchor) : -1;
    if (boundary === undefined) continue;
    const signature = messageSignature(local);
    const index = messages.findIndex(
      (message, position) =>
        !consumed.has(position) &&
        (message.id === local.id || (position > boundary && signatures[position] === signature)),
    );
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
