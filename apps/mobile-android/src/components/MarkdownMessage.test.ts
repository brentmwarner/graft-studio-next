import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MarkdownMessage } from "./MarkdownMessage";

vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  ScrollView: "ScrollView",
  Linking: {},
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("react-native-reanimated", () => ({ default: { Text: "AnimatedText" } }));
vi.mock("../theme/tokens", () => ({
  useGraftPalette: () => ({ foreground: "#000", foregroundSubtle: "#777" }),
  graftRadius: {},
}));
let renderer: ReactTestRenderer;
const frame = (children: string, streaming = true) =>
  // eslint-disable-next-line react/no-children-prop -- createElement requires the component's children prop.
  createElement(MarkdownMessage, { children, streaming });
const animated = () => renderer.root.findAll((node) => (node.type as unknown) === "AnimatedText");
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});
it("fades appended ordinary prose without replaying already received text", async () => {
  await act(() => {
    renderer = create(frame("Hello"));
  });
  expect(animated()).toHaveLength(0);
  await act(() => renderer.update(frame("Hello there")));
  expect(animated().map((node) => node.props.children)).toEqual([" there"]);
  const span = animated()[0];
  const animation = span?.props.style;
  await act(() => renderer.update(frame("Hello there friend")));
  expect(animated()[0]).toBe(span);
  expect(animated()[0]?.props.style).toBe(animation);
  await act(() => renderer.update(frame("Hello there friend", false)));
  expect(animated()).toHaveLength(0);
});
