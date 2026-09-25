import { createElement, type ComponentProps } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Composer } from "./Composer";
import { ComposerSettings } from "./ComposerSettings";

vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Text: "Text",
  View: "View",
  TextInput: "TextInput",
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Keyboard: { addListener: () => ({ remove: () => undefined }) },
  useWindowDimensions: () => ({ height: 800, fontScale: 1 }),
}));
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" } }));
vi.mock("../../components/disclosureMotion", () => ({ useDisclosureHeightTransition: () => ({}) }));
vi.mock("../../components/FloatingSurface", () => ({ FloatingSurface: "Surface" }));
vi.mock("../../components/PressScale", () => ({ PressScale: "Press" }));
vi.mock("../../components/ProviderLogo", () => ({ ProviderLogo: "ProviderLogo" }));
vi.mock("../../theme/tokens", () => ({ useGraftPalette: () => ({}), graftRadius: { pill: 999 } }));
vi.mock("./ComposerConfigMenu", () => ({ ComposerConfigMenu: "Menu" }));
vi.mock("./ComposerAttachments", () => ({ ComposerAttachments: "Attachments" }));
vi.mock("./RecordingComposer", () => ({ RecordingComposer: "Recording" }));

const props: ComponentProps<typeof Composer> = {
  attachments: [],
  onRemoveAttachment: vi.fn(),
  activeRunId: undefined,
  canSend: false,
  currentModelName: "GPT",
  draft: "",
  hostLabel: "Studio",
  isConnected: true,
  isSending: false,
  onCancel: vi.fn(),
  onDraftChange: vi.fn(),
  onSend: vi.fn(),
  onSendDictation: vi.fn(),
  menuConfig: {
    currentApproval: "ask",
    approvalOptions: [{ value: "ask", label: "Ask first" }],
    currentModel: undefined,
    models: [],
    efforts: [],
    resolvedEffort: undefined,
    enabled: true,
    onSelectApproval: () => true,
    onSelectModel: () => true,
    onSelectEffort: vi.fn(),
  },
  voice: {
    phase: "idle",
    isActive: false,
    error: undefined,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
  },
};
let renderer: ReactTestRenderer;
const isType = (node: { type: unknown }, type: string) => node.type === type;
const input = () => renderer.root.find((node) => isType(node, "TextInput"));
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

it("keeps model controls inside the composer and preserves input/picker identity while typing", async () => {
  await act(() => {
    renderer = create(createElement(Composer, props));
  });
  const editor = input();
  const settings = renderer.root.findByType(ComposerSettings);
  expect(settings.parent?.parent?.parent?.type).toBe("AnimatedView");
  expect(settings.props.showProviderIcon).toBe(false);
  await act(() => editor.props.onFocus());
  expect(settings.props.showProviderIcon).toBe(true);
  await act(() =>
    renderer.update(
      createElement(Composer, { ...props, draft: "Follow up", canSend: true, modelMenuRequest: 1 }),
    ),
  );
  expect(input()).toBe(editor);
  expect(input().props.value).toBe("Follow up");
  expect(renderer.root.findByType(ComposerSettings)).toBe(settings);
  expect(settings.props.modelMenuRequest).toBe(1);
});

it("keeps the permissions shortcut beside the plus button whenever policies exist", async () => {
  await act(() => {
    renderer = create(createElement(Composer, props));
  });
  const menus = () => renderer.root.findAll((node) => isType(node, "Menu"));
  // The leading toolbar group holds the plus menu and the permissions shortcut.
  const leadingPages = () => {
    const leading = menus().find((node) => node.props.initialPage === "options")!.parent!;
    expect(leading.type).toBe("View");
    return leading.findAll((node) => isType(node, "Menu")).map((node) => node.props.initialPage);
  };
  expect(leadingPages()).toEqual(["options", "permissions"]);
  await act(() => input().props.onFocus());
  expect(leadingPages()).toEqual(["options", "permissions"]);
  await act(() =>
    renderer.update(
      createElement(Composer, {
        ...props,
        menuConfig: { ...props.menuConfig, approvalOptions: [], currentApproval: undefined },
      }),
    ),
  );
  expect(menus().some((node) => node.props.initialPage === "permissions")).toBe(false);
});

it("replaces model and permission chips while a slash command is open", async () => {
  const permissionMenus = () =>
    renderer.root.findAll(
      (node) => isType(node, "Menu") && node.props.initialPage === "permissions",
    );
  await act(() => {
    renderer = create(createElement(Composer, { ...props, draft: "/" }));
  });
  expect(renderer.root.findAllByType(ComposerSettings)).toHaveLength(0);
  expect(permissionMenus()).toHaveLength(0);
  expect(
    renderer.root.findAll((node) => isType(node, "Menu") && node.props.initialPage === "options"),
  ).toHaveLength(1);

  await act(() => {
    renderer.update(createElement(Composer, { ...props, draft: "/review " }));
  });
  expect(renderer.root.findAllByType(ComposerSettings)).toHaveLength(1);
  expect(permissionMenus()).toHaveLength(1);

  await act(() => {
    renderer.update(createElement(Composer, { ...props, draft: "" }));
  });
  expect(renderer.root.findAllByType(ComposerSettings)).toHaveLength(1);
  expect(permissionMenus()).toHaveLength(1);
});

it("preserves the editor and hides its controls from accessibility during dictation", async () => {
  await act(() => {
    renderer = create(createElement(Composer, props));
  });
  const editor = input();
  await act(() =>
    renderer.update(
      createElement(Composer, {
        ...props,
        voice: { ...props.voice, phase: "listening", isActive: true },
      }),
    ),
  );
  expect(input()).toBe(editor);
  expect(
    renderer.root.findByType(ComposerSettings).parent?.parent?.parent?.props
      .importantForAccessibility,
  ).toBe("no-hide-descendants");
  expect(input().props.editable).toBe(false);
});

it("collapses to one row on blur even with a draft, without replacing the editor", async () => {
  await act(() => {
    renderer = create(createElement(Composer, { ...props, draft: "Unsent draft" }));
  });
  const editor = input();
  const height = () =>
    renderer.root.find((node) => isType(node, "AnimatedView")).props.style[2].height;
  expect(height()).toBe(56);
  expect(input().props.multiline).toBe(false);
  await act(() => editor.props.onFocus());
  expect(height()).toBeGreaterThan(100);
  expect(input().props.multiline).toBe(true);
  await act(() => editor.props.onBlur());
  expect(renderer.root.findByType(ComposerSettings).props.showProviderIcon).toBe(false);
  expect(height()).toBe(56);
  expect(input().props.multiline).toBe(false);
  expect(input()).toBe(editor);
  expect(input().props.value).toBe("Unsent draft");
});
