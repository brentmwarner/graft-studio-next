import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GraftTimelineEvent } from "@graft/mobile-contract";

import { useStreamingHaptics } from "./useStreamingHaptics";

const native = vi.hoisted(() => ({
  tick: vi.fn(() => Promise.resolve()),
  state: "active",
  reduced: false,
}));
vi.mock("expo-haptics", () => ({
  AndroidHaptics: { Segment_Frequent_Tick: "tick" },
  performAndroidHapticsAsync: native.tick,
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return native.state;
    },
    addEventListener: () => ({ remove: () => undefined }),
  },
}));
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => native.reduced }));
let renderer: ReactTestRenderer;
function Harness({
  events,
  enabled = true,
  runId = "r",
}: {
  events: readonly GraftTimelineEvent[];
  enabled?: boolean;
  runId?: string;
}) {
  useStreamingHaptics("thread", runId, events, enabled);
  return null;
}
const delta = (
  cursor: number,
  text = `Text ${cursor}`,
  kind: GraftTimelineEvent["kind"] = "assistant.delta",
): GraftTimelineEvent => ({
  id: `a:delta:${cursor}`,
  threadId: "thread",
  runId: "r",
  createdAt: 1000,
  cursor,
  kind,
  text,
});
const update = async (events: readonly GraftTimelineEvent[], enabled = true) =>
  act(() => renderer.update(createElement(Harness, { events, enabled })));
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.tick.mockClear();
  native.state = "active";
  native.reduced = false;
  await act(() => {
    renderer = create(createElement(Harness, { events: [] }));
  });
});
afterEach(async () => {
  await act(() => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("only ticks on fresh appended text, at most three times per run and 1.2s apart", async () => {
  await update([delta(1, "A")]);
  expect(native.tick).not.toHaveBeenCalled();
  await update([delta(2, "AB")]);
  await update([delta(3, "ABC")]);
  expect(native.tick).toHaveBeenCalledTimes(1);
  for (let index = 4; index < 10; index++) {
    vi.advanceTimersByTime(1200);
    await update([delta(index, "ABC" + "D".repeat(index))]);
  }
  expect(native.tick).toHaveBeenCalledTimes(3);
});
it("does not tick for tools, corrections, duplicate frames, history or reconnect catch-up", async () => {
  await update([delta(1, "A")]);
  await update([delta(2, "A", "tool.update")]);
  await update([delta(3, "Corrected")]);
  await update([delta(4, "Corrected")]);
  await update([delta(5, "Corrected text")], false);
  await update([delta(6, "Corrected text catch-up")], true);
  expect(native.tick).not.toHaveBeenCalled();
});
it("respects background and reduced motion, and tolerates unavailable haptics", async () => {
  await update([delta(1, "A")]);
  native.state = "background";
  await update([delta(2, "AB")]);
  native.state = "active";
  native.reduced = true;
  await update([delta(3, "ABC")]);
  expect(native.tick).not.toHaveBeenCalled();
  native.reduced = false;
  native.tick.mockRejectedValueOnce(new Error("unsupported"));
  await update([delta(4, "ABCD")]);
  expect(native.tick).toHaveBeenCalledTimes(1);
});
