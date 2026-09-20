import { expect, it, vi } from "vitest";

import { appendReveal } from "./StreamingText";

vi.mock("react-native", () => ({ Text: "Text" }));
vi.mock("react-native-reanimated", () => ({ default: { Text: "AnimatedText" } }));
vi.mock("../theme/tokens", () => ({ useGraftPalette: () => ({}) }));
const initial = { text: "Hello", base: "Hello", spans: [] };
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
