import type { TranscriptItem } from "./mobileViewModels";

/// Distance from the bottom edge, in points, at which we consider the
/// transcript "at the latest" again — hide the jump button and resume
/// following. Keep a small tolerance for native rounding.
export const NEAR_BOTTOM_DISTANCE = 24;

/// How far off the bottom a *drag* has to travel before we surface the jump
/// button. Deliberately above `NEAR_BOTTOM_DISTANCE` so the two form a
/// hysteresis band. A short deliberate drag is enough to stop following.
export const AWAY_FROM_BOTTOM_DISTANCE = 64;

export interface FollowLatchInput {
  /// `contentSize.height - (contentOffset.y + layoutMeasurement.height)`.
  /// Negative while overscrolling past the bottom.
  readonly distanceFromBottom: number;
  readonly isAway: boolean;
  /// True only for finger-driven scrolling (drag or its fling), never for a
  /// programmatic `scrollToEnd`.
  readonly isUserDragging: boolean;
}

/// Decide whether the transcript should be latched "away from the latest".
///
/// Only a real drag may ARM the latch. A programmatic follow-scroll transiently
/// reports a large distance while the transcript is still growing, and letting
/// that arm the latch stuck the jump button on and disabled streaming follow
/// for the rest of the thread. Disarming, by contrast, happens however we got
/// back to the bottom — a jump, a send, or scrolling down by hand.
export function nextFollowLatch({
  distanceFromBottom,
  isAway,
  isUserDragging,
}: FollowLatchInput): boolean {
  if (distanceFromBottom <= NEAR_BOTTOM_DISTANCE) return false;
  if (isUserDragging && distanceFromBottom > AWAY_FROM_BOTTOM_DISTANCE) {
    return true;
  }
  return isAway;
}

/** Tool/reasoning/status churn must not look like a newly arrived message. */
export function transcriptFollowContent(items: readonly TranscriptItem[]) {
  let messageCount = 0;
  let lastMessageId = "";
  let lastMessageText = "";
  for (const item of items) {
    if (item.kind !== "user" && !(item.kind === "assistant" && item.text)) continue;
    messageCount += 1;
    lastMessageId = item.id;
    lastMessageText = item.text;
  }
  const tail = items.at(-1);
  return {
    messageCount, lastMessageId, lastMessageText,
    streaming: tail?.kind === "assistant" && Boolean(tail.text) && tail.streaming,
  };
}
