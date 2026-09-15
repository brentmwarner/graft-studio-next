import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptItem } from "../../state/mobileViewModels";
import { useTranscriptFollow } from "./useTranscriptFollow";

type Follow = ReturnType<typeof useTranscriptFollow>;
let follow: Follow;
let renderer: ReactTestRenderer;
const scroll = vi.fn();
const answer: TranscriptItem = {
  id: "answer",
  kind: "assistant",
  text: "Hello",
  reasoning: "",
  streaming: true,
};
function Harness({
  items,
  canStream = true,
}: {
  items: readonly TranscriptItem[];
  canStream?: boolean;
}) {
  follow = useTranscriptFollow("thread", items, canStream);
  return null;
}
function scrollEvent(offset: number, velocity = 0): NativeSyntheticEvent<NativeScrollEvent> {
  return {
    nativeEvent: {
      contentOffset: { y: offset },
      contentSize: { height: 1000 },
      layoutMeasurement: { height: 400 },
      velocity: { y: velocity },
    },
  } as NativeSyntheticEvent<NativeScrollEvent>;
}
async function update(items: readonly TranscriptItem[], canStream = true) {
  await act(() => renderer.update(createElement(Harness, { items, canStream })));
}
async function layout(height = 1000) {
  await act(() => {
    follow.handleContentSizeChange(400, height);
    vi.runAllTimers();
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  await act(() => {
    renderer = create(createElement(Harness, { items: [answer] }));
  });
  follow.listRef.current = { scrollToOffset: scroll } as unknown as NonNullable<
    Follow["listRef"]["current"]
  >;
  await layout();
  scroll.mockClear();
});
afterEach(async () => {
  await act(() => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("transcript follow", () => {
  it("follows text growth once per frame", async () => {
    await update([{ ...answer, text: "Hello there" }]);
    await act(() => {
      follow.handleContentSizeChange(400, 1100);
      follow.handleContentSizeChange(400, 1150);
      vi.runAllTimers();
    });
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ offset: 1150, animated: false });
  });
  it("stops following as soon as the finger touches the transcript", async () => {
    await act(() => follow.handleScrollBeginDrag());
    await update([{ ...answer, text: "More text" }]);
    await layout(1100);
    expect(scroll).not.toHaveBeenCalled();
  });
  it("preserves reading position through reconnect until jump to latest", async () => {
    await act(() => {
      follow.handleScrollBeginDrag();
      follow.handleScroll(scrollEvent(100));
      follow.handleScrollEndDrag(scrollEvent(100, -2));
    });
    await update([answer], false);
    await update([answer], true);
    await layout(1200);
    expect(follow.isAwayFromBottom).toBe(true);
    expect(scroll).not.toHaveBeenCalled();
    await act(() => {
      follow.jumpToLatest();
      vi.runAllTimers();
    });
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ offset: 1200, animated: true });
  });
  it("does not follow tool-only growth", async () => {
    const tool: TranscriptItem = {
      id: "tool",
      kind: "tool",
      toolId: "tool",
      name: "Bash",
      detail: "Working",
      running: true,
    };
    await update([{ ...answer, streaming: false }, tool]);
    await layout(1200);
    await update([
      { ...answer, streaming: false },
      { ...tool, detail: "More tool output" },
    ]);
    await layout(1300);
    expect(scroll).not.toHaveBeenCalled();
  });
  it("cancels a queued follow when the user starts scrolling", async () => {
    await update([{ ...answer, text: "More output" }]);
    await act(() => {
      follow.handleScrollBeginDrag();
      vi.runAllTimers();
    });
    expect(scroll).not.toHaveBeenCalled();
  });
});
