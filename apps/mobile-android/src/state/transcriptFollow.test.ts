import { describe, expect, it } from "vitest";

import { presentTranscriptRows, type TranscriptItem } from "./mobileViewModels";
import {
  AWAY_FROM_BOTTOM_DISTANCE,
  NEAR_BOTTOM_DISTANCE,
  nextFollowLatch,
  transcriptFollowContent,
} from "./transcriptFollow";

describe("nextFollowLatch", () => {
  it("arms when a real drag pulls meaningfully off the bottom", () => {
    expect(
      nextFollowLatch({
        distanceFromBottom: AWAY_FROM_BOTTOM_DISTANCE + 1,
        isAway: false,
        isUserDragging: true,
      }),
    ).toBe(true);
  });

  it("never arms from programmatic scrolling", () => {
    // The regression: `scrollToEnd` while the transcript is still growing
    // reports a large distance for a frame or two. Arming there latched the
    // jump button on and killed streaming follow for the rest of the thread.
    expect(
      nextFollowLatch({
        distanceFromBottom: AWAY_FROM_BOTTOM_DISTANCE * 4,
        isAway: false,
        isUserDragging: false,
      }),
    ).toBe(false);
  });

  it("disarms once we are back near the bottom, however we got there", () => {
    for (const isUserDragging of [true, false]) {
      expect(
        nextFollowLatch({
          distanceFromBottom: NEAR_BOTTOM_DISTANCE,
          isAway: true,
          isUserDragging,
        }),
      ).toBe(false);
    }
  });

  it("holds the latch steady inside the hysteresis band", () => {
    // Between the two thresholds nothing changes, so a single sloppy frame
    // can't flicker the jump button in or out.
    const distanceFromBottom = (NEAR_BOTTOM_DISTANCE + AWAY_FROM_BOTTOM_DISTANCE) / 2;
    expect(nextFollowLatch({ distanceFromBottom, isAway: true, isUserDragging: true })).toBe(true);
    expect(
      nextFollowLatch({
        distanceFromBottom,
        isAway: false,
        isUserDragging: true,
      }),
    ).toBe(false);
  });

  it("keeps a deliberate scroll-up armed while content streams in", () => {
    expect(
      nextFollowLatch({
        distanceFromBottom: AWAY_FROM_BOTTOM_DISTANCE * 3,
        isAway: true,
        isUserDragging: false,
      }),
    ).toBe(true);
  });

  it("treats overscroll past the bottom as being at the bottom", () => {
    expect(
      nextFollowLatch({
        distanceFromBottom: -120,
        isAway: true,
        isUserDragging: true,
      }),
    ).toBe(false);
  });

  it("keeps the disarm threshold below the arm threshold", () => {
    expect(NEAR_BOTTOM_DISTANCE).toBeLessThan(AWAY_FROM_BOTTOM_DISTANCE);
  });
});

describe("transcriptFollowContent", () => {
  it("keeps message identity stable when commentary folds out of the presented list", () => {
    const unfurled: TranscriptItem[] = [
      { id: "u", kind: "user", text: "Fix it" },
      { id: "c", kind: "assistant", text: "Inspecting the code.", reasoning: "", streaming: false },
      { id: "t", kind: "tool", toolId: "t", name: "Read", detail: "", running: false },
      { id: "a", kind: "assistant", text: "Fixed.", reasoning: "", streaming: false },
    ];
    const folded = presentTranscriptRows(unfurled, false);

    expect(transcriptFollowContent(unfurled)).toEqual({
      messageCount: 3,
      lastMessageId: "a",
      lastMessageText: "Fixed.",
      streaming: false,
    });
    expect(transcriptFollowContent(folded)).not.toEqual(transcriptFollowContent(unfurled));
    expect(transcriptFollowContent(folded)).toEqual({
      messageCount: 2,
      lastMessageId: "a",
      lastMessageText: "Fixed.",
      streaming: false,
    });
  });
});
