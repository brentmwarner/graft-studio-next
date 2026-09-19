import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ComposerSettings } from "./ComposerSettings";
import type { ComposerMenuConfig } from "./ComposerConfigMenu";

vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));
vi.mock("../../components/FloatingSurface", () => ({ FloatingSurface: "Surface" }));
vi.mock("../../components/PressScale", () => ({ PressScale: "Press" }));
vi.mock("../../theme/tokens", () => ({
  useGraftPalette: () => ({ foreground: "black", foregroundMuted: "grey", warning: "orange" }),
}));
vi.mock("./ComposerConfigMenu", () => ({
  ComposerConfigMenu: ({ trigger, ...props }: { trigger: (open: () => void) => ReactNode }) =>
    createElement(
      "Menu",
      props,
      trigger(() => undefined),
    ),
}));
const config: ComposerMenuConfig = {
  currentApproval: undefined,
  approvalOptions: [],
  currentModel: undefined,
  models: [],
  efforts: [],
  resolvedEffort: undefined,
  enabled: true,
  onSelectApproval: () => true,
  onSelectModel: () => true,
  onSelectEffort: () => undefined,
};
let renderer: ReactTestRenderer | undefined;
const isMenu = (node: { type: unknown }) => node.type === "Menu";
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("keeps a model picker mounted without a draft or loaded catalog and receives /model requests", async () => {
  await act(() => {
    renderer = create(
      createElement(ComposerSettings, {
        config,
        modelMenuRequest: 2,
      }),
    );
  });
  const menu = renderer!.root.find(isMenu);
  expect(menu.props.initialPage).toBe("intelligence");
  expect(menu.props.openRequest).toBe(2);
  expect(JSON.stringify(renderer!.toJSON())).toContain("Choose model");
});

it("combines the current model and effort in one compact control", async () => {
  await act(() => {
    renderer = create(
      createElement(ComposerSettings, {
        config: { ...config, efforts: ["low", "high"], resolvedEffort: "high" },
      }),
    );
  });
  expect(renderer!.root.findAll(isMenu).map((node) => node.props.initialPage)).toEqual([
    "intelligence",
  ]);
});
