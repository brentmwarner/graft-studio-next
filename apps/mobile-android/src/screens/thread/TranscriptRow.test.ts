import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LiveStatusLine } from "../../components/LiveStatusLine";
import type { TranscriptItem } from "../../state/mobileViewModels";
import { TranscriptRow } from "./TranscriptRow";

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  useColorScheme: () => "light",
  Linking: { openURL: vi.fn() },
}));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
vi.mock("@expo/ui/jetpack-compose", () => ({
  Host: "ComposeHost",
  Text: "ComposeText",
}));
vi.mock("../../components/RunStatusDotMatrix", () => ({
  RunStatusDotMatrix: "DotMatrix",
}));
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => false }));
vi.mock("../../components/ActivityCard", () => ({ ActivityCard: "ActivityCard" }));

let renderer: ReactTestRenderer;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

it("renders running reasoning and tools without another live indicator", async () => {
  const items: TranscriptItem[] = [
    { id: "thought", kind: "assistant", text: "", reasoning: "Looking into it", streaming: true },
    { id: "tool", kind: "tool", toolId: "tool", name: "Read", detail: "src/app.ts", running: true },
    {
      id: "group",
      kind: "toolGroup",
      tools: [{ id: "t2", kind: "tool", toolId: "t2", name: "Bash", detail: "pwd", running: true }],
    },
  ];
  await act(() => {
    renderer = create(
      createElement(
        "Transcript",
        null,
        ...items.map((item) => createElement(TranscriptRow, { key: item.id, item })),
        createElement(LiveStatusLine, { phrase: "Reading files" }),
      ),
    );
  });
  const dotLoaders = renderer.root.findAll((node) => node.type === "DotMatrix");
  expect(dotLoaders).toHaveLength(1);
  expect(
    renderer.root.findAll((node) => node.props.accessibilityLiveRegion === "polite"),
  ).toHaveLength(1);
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Looking into it");
});

it("updates a status phrase without remounting its dot loader", async () => {
  await act(() => {
    renderer = create(createElement(LiveStatusLine, { phrase: "Thinking" }));
  });
  const indicator = renderer.root.find((node) => node.type === "DotMatrix");
  await act(() => renderer.update(createElement(LiveStatusLine, { phrase: "Reading files" })));
  expect(renderer.root.find((node) => node.type === "DotMatrix")).toBe(indicator);
  await act(() =>
    renderer.update(createElement(LiveStatusLine, { phrase: "Waiting for you", animating: false })),
  );
  expect(renderer.root.findAll((node) => node.type === "DotMatrix")).toHaveLength(0);
});
