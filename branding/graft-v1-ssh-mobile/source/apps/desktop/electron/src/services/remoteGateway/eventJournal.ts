import type { GraftRemoteCursor, GraftTimelineEvent } from "@graft/shared";

const DEFAULT_CAPACITY = 5_000;

/**
 * In-memory event journal for mobile cursor replay.
 * Desktop DB-backed persistence can replace this adapter later.
 */
export type EventJournal = {
  append: (event: Omit<GraftTimelineEvent, "cursor">) => GraftTimelineEvent;
  replayAfter: (afterCursor: GraftRemoteCursor) => {
    events: GraftTimelineEvent[];
    latestCursor: GraftRemoteCursor;
    snapshotRequired: boolean;
  };
  latestCursor: () => GraftRemoteCursor;
  clear: () => void;
};

export function createEventJournal(
  capacity = DEFAULT_CAPACITY,
): EventJournal {
  const events: GraftTimelineEvent[] = [];
  let cursor: GraftRemoteCursor = 0;
  let earliestCursor: GraftRemoteCursor | null = null;

  return {
    append(partial) {
      cursor += 1;
      const event: GraftTimelineEvent = { ...partial, cursor };
      events.push(event);
      if (earliestCursor === null) earliestCursor = cursor;
      while (events.length > capacity) {
        events.shift();
        earliestCursor = events[0]?.cursor ?? null;
      }
      return event;
    },
    replayAfter(afterCursor) {
      if (
        earliestCursor !== null &&
        afterCursor + 1 < earliestCursor &&
        events.length > 0
      ) {
        return {
          events: [],
          latestCursor: cursor,
          snapshotRequired: true,
        };
      }
      const replay = events.filter((event) => event.cursor > afterCursor);
      return {
        events: replay,
        latestCursor: cursor,
        snapshotRequired: false,
      };
    },
    latestCursor() {
      return cursor;
    },
    clear() {
      events.length = 0;
      cursor = 0;
      earliestCursor = null;
    },
  };
}
