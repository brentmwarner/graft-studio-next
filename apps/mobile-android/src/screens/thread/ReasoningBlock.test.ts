import {
  DISCLOSURE_CLEANUP_BUFFER_MS,
  DISCLOSURE_TRANSITION_MS,
} from "@graft/shared/disclosureMotion";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { TranscriptItem } from "../../state/mobileViewModels";
import { ReasoningBlock } from "./ReasoningBlock";

vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
}));
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
  cubicBezier: (...values: number[]) => values,
  useReducedMotion: () => motion.reduced,
}));
vi.mock("../../components/MarkdownMessage", () => ({ MarkdownMessage: "Markdown" }));
vi.mock("../../theme/tokens", () => ({ useGraftPalette: () => ({}) }));
vi.mock("./ToolActivity", () => ({ ToolRow: "Tool" }));

const note: TranscriptItem = {
  id: "note",
  kind: "assistant",
  text: "I found the issue",
  reasoning: "Checking the file",
  streaming: false,
};
const tool: TranscriptItem = {
  id: "tool",
  kind: "tool",
  toolId: "tool",
  name: "Read",
  detail: "src/app.ts",
  running: false,
};
let renderer: ReactTestRenderer;
const isType = (node: { type: unknown }, name: string) => node.type === name;
const toggle = () => renderer.root.find((node) => isType(node, "Pressable"));
const body = () => renderer.root.find((node) => node.props.importantForAccessibility !== undefined);
const indicator = () =>
  renderer.root.find((node) => node.props.style?.transitionProperty === "transform");
const measuredBody = () => renderer.root.find((node) => typeof node.props.onLayout === "function");
const markdown = () => renderer.root.findAll((node) => isType(node, "Markdown"));

beforeEach(() => {
  motion.reduced = false;
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("animates measured work and its indicator with shared timing and retains content through closing", async () => {
  await act(() => {
    renderer = create(
      createElement(ReasoningBlock, { reasoning: "", foldedActivity: [note, tool] }),
    );
  });
  expect(markdown()).toHaveLength(0);
  expect(body().props.importantForAccessibility).toBe("no-hide-descendants");
  await act(() => toggle().props.onPress());
  await act(() => measuredBody().props.onLayout({ nativeEvent: { layout: { height: 140 } } }));
  expect(body().props.style.at(-1).height).toBe(140);
  expect(body().props.style[1].transitionDuration).toBe(DISCLOSURE_TRANSITION_MS);
  expect(indicator().props.style.transitionDuration).toBe(DISCLOSURE_TRANSITION_MS);
  expect(indicator().props.style.transform).toEqual([{ rotate: "90deg" }]);
  const content = markdown()[0];
  await act(() => toggle().props.onPress());
  expect(body().props.style.at(-1).height).toBe(0);
  expect(body().props.importantForAccessibility).toBe("no-hide-descendants");
  expect(body().props.pointerEvents).toBe("none");
  expect(markdown()[0]).toBe(content);
  await act(() => {
    vi.advanceTimersByTime(DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS);
  });
  expect(markdown()).toHaveLength(0);
});

it("does not animate or retain closing content when reduced motion is enabled", async () => {
  motion.reduced = true;
  await act(() => {
    renderer = create(createElement(ReasoningBlock, { reasoning: "", foldedActivity: [note] }));
  });
  await act(() => toggle().props.onPress());
  expect(body().props.style[1].transitionDuration).toBe(0);
  expect(indicator().props.style.transitionDuration).toBe(0);
  await act(() => toggle().props.onPress());
  expect(markdown()).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels closing cleanup when reopened and follows expanded tool detail height", async () => {
  await act(() => {
    renderer = create(
      createElement(ReasoningBlock, { reasoning: "", foldedActivity: [note, tool] }),
    );
  });
  await act(() => toggle().props.onPress());
  const content = markdown()[0];
  await act(() => measuredBody().props.onLayout({ nativeEvent: { layout: { height: 140 } } }));
  await act(() => toggle().props.onPress());
  await act(() => {
    vi.advanceTimersByTime(DISCLOSURE_TRANSITION_MS / 2);
  });
  await act(() => toggle().props.onPress());
  await act(() => {
    vi.advanceTimersByTime(DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS);
  });
  expect(markdown()[0]).toBe(content);
  expect(body().props.importantForAccessibility).toBe("auto");
  await act(() => measuredBody().props.onLayout({ nativeEvent: { layout: { height: 240 } } }));
  expect(body().props.style.at(-1).height).toBe(240);
});

it("starts Worked collapsed even when the live Thoughts were expanded", async () => {
  await act(() => {
    renderer = create(createElement(ReasoningBlock, { reasoning: "Checking the file" }));
  });
  await act(() => toggle().props.onPress());
  expect(toggle().props.accessibilityState.expanded).toBe(true);
  await act(() =>
    renderer.update(
      createElement(ReasoningBlock, { reasoning: "Checking the file", foldedActivity: [note] }),
    ),
  );
  expect(toggle().props.accessibilityLabel).toBe("Worked");
  expect(toggle().props.accessibilityState.expanded).toBe(false);
  expect(markdown()).toHaveLength(0);
  await act(() => toggle().props.onPress());
  expect(markdown()).toHaveLength(1);
});
