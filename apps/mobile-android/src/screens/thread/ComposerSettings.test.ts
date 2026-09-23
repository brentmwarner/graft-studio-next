import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ComposerPermissions, ComposerSettings } from "./ComposerSettings";
import type { ComposerMenuConfig } from "./ComposerConfigMenu";

vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));
vi.mock("../../components/ProviderLogo", () => ({ ProviderLogo: "ProviderLogo" }));
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

it("shows only the model name while keeping effort accessible in the picker", async () => {
  await act(() => {
    renderer = create(
      createElement(ComposerSettings, {
        config: { ...config, efforts: ["low", "high"], resolvedEffort: "high" },
      }),
    );
  });
  expect(renderer!.root.findAll((node) => (node.type as unknown) === "ProviderLogo")).toHaveLength(
    0,
  );
  expect(
    renderer!.root
      .findAll((node) => (node.type as unknown) === "Text")
      .map((node) => node.props.children),
  ).toEqual(["Choose model"]);
  expect(renderer!.root.findAll(isMenu).map((node) => node.props.initialPage)).toEqual([
    "intelligence",
  ]);
});

it("opens permissions directly and tints the shield when the policy exceeds the default", async () => {
  const approvalOptions = [
    { value: "ask", label: "Ask first" },
    { value: "full", label: "Full access" },
  ];
  const model = {
    id: "codex",
    label: "Codex",
    providerId: "codex",
    defaultApprovalPolicy: "ask",
  };
  await act(() => {
    renderer = create(
      createElement(ComposerPermissions, {
        config: { ...config, approvalOptions, currentApproval: "ask", currentModel: model },
      }),
    );
  });
  const menu = () => renderer!.root.find(isMenu);
  const icon = () => renderer!.root.find((node) => (node.type as unknown) === "Icon");
  expect(menu().props.initialPage).toBe("permissions");
  expect(icon().props.color).toBe("grey");
  expect(renderer!.root.find((node) => (node.type as unknown) === "Press").props).toMatchObject({
    accessibilityLabel: "Permissions: Ask first",
    disabled: false,
  });
  await act(() =>
    renderer!.update(
      createElement(ComposerPermissions, {
        config: { ...config, approvalOptions, currentApproval: "full", currentModel: model },
      }),
    ),
  );
  expect(icon().props.color).toBe("orange");
  await act(() => renderer!.update(createElement(ComposerPermissions, { config: { ...config } })));
  expect(renderer!.toJSON()).toBeNull();
});

it("shows the provider's untinted logo alongside the model when expanded", async () => {
  await act(() => {
    renderer = create(
      createElement(ComposerSettings, {
        config: {
          ...config,
          currentModel: { id: "claude-test", label: "Claude", providerId: "claudeAgent" },
        },
        showProviderIcon: true,
      }),
    );
  });
  const logo = renderer!.root.find((node) => (node.type as unknown) === "ProviderLogo");
  expect(logo.props.providerId).toBe("claudeAgent");
  expect(logo.props.color).toBeUndefined();
});
