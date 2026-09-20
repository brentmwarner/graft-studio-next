import { createElement, StrictMode, Suspense } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { appendReveal, StreamingText } from "./StreamingText";

vi.mock("react-native", () => ({ Text: "Text" }));
vi.mock("react-native-reanimated", () => ({ default: { Text: "AnimatedText" } }));
vi.mock("../theme/tokens", () => ({ useGraftPalette: () => ({}) }));
const initial = { text: "Hello", base: "Hello", spans: [] };
let renderer: ReactTestRenderer | undefined;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
it("reveals only appended text and preserves the entire received value", () => {
  const next = appendReveal(initial, "Hello there 👋", true, 1000);
  expect(next.base).toBe("Hello");
  expect(next.spans.map((span) => span.text).join("")).toBe(" there 👋");
});
it("bounds animated spans during long streams without dropping or delaying text", () => {
  let state = initial as ReturnType<typeof appendReveal>;
  for (let index = 0; index < 1000; index++) {
    state = appendReveal(state, `${state.text} word`, true, index * 10);
    expect(state.spans.length).toBeLessThanOrEqual(8);
    expect(state.base + state.spans.map((span) => span.text).join("")).toBe(state.text);
  }
});
it("flushes completion, reduced motion and corrections without animation", () => {
  const next = appendReveal(initial, "Hello there", true, 0);
  expect(appendReveal(next, next.text, false, 1).spans).toEqual([]);
  expect(appendReveal(next, "Corrected", true, 1)).toEqual({
    text: "Corrected",
    base: "Corrected",
    spans: [],
  });
});
it("does not advance the reveal baseline for a suspended render", async () => {
  const pending = new Promise<never>(() => {});
  function Suspend({ enabled }: { enabled: boolean }) {
    if (enabled) throw pending;
    return null;
  }
  const frame = (text: string, suspend = false, animate = true) =>
    createElement(
      StrictMode,
      null,
      createElement(
        Suspense,
        { fallback: "pending" },
        createElement(StreamingText, { text, animate }),
        createElement(Suspend, { enabled: suspend }),
      ),
    );
  const animated = () =>
    renderer!.root.findAll((node) => (node.type as unknown) === "AnimatedText");
  await act(() => {
    renderer = create(frame("Hello"));
  });
  expect(animated()).toHaveLength(0);
  await act(() => renderer!.update(frame("Hello speculative", true)));
  await act(() => renderer!.update(frame("Hello friend")));
  expect(animated().map((node) => node.props.children)).toEqual([" friend"]);
  expect(renderer!.toJSON()).toEqual({
    type: "Text",
    props: {},
    children: ["Hello", expect.objectContaining({ children: [" friend"] })],
  });
  await act(() => renderer!.update(frame("Hello friend", false, false)));
  expect(renderer!.toJSON()).toBe("Hello friend");
  await act(() => renderer!.update(frame("Hello friend again")));
  expect(animated().map((node) => node.props.children)).toEqual([" again"]);
});
