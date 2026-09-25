import { createElement, type ComponentProps } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

import { NewChatScreen } from "./NewChatScreen";

vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
vi.mock("react-native", () => ({
  KeyboardAvoidingView: "Screen",
  Platform: { OS: "android" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24 }),
}));
vi.mock("../components/BottomSheet", () => ({ BottomSheet: () => null }));
vi.mock("../components/CircleIconButton", () => ({ CircleIconButton: "CircleIconButton" }));
vi.mock("../components/EdgeFade", () => ({ EdgeFade: "EdgeFade" }));
vi.mock("../components/FloatingSurface", () => ({ FloatingSurface: "Surface" }));
vi.mock("../components/PressScale", () => ({ PressScale: "Press" }));
vi.mock("../theme/tokens", () => ({ useGraftPalette: () => ({}), graftRadius: {} }));
vi.mock("./thread/Composer", () => ({ Composer: "Composer" }));
vi.mock("./thread/useComposerAttachments", () => ({
  useComposerAttachments: () => ({ attachments: [], retainForSend: () => () => {} }),
}));
vi.mock("./thread/useVoiceInput", () => ({ useVoiceInput: () => ({ isActive: false }) }));
vi.mock("./thread/useKeyboardVisibility", () => ({ useKeyboardVisibility: () => false }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer;
afterEach(async () => {
  await act(async () => renderer?.unmount());
});

it("opens skills before creating a thread and sends the selected invocation", async () => {
  const load = vi
    .fn()
    .mockResolvedValue([
      { name: "review", displayName: "Code audit", description: "Review code", kind: "skill" },
    ]);
  const createThread = vi.fn().mockResolvedValue({ sent: false });
  const props: ComponentProps<typeof NewChatScreen> = {
    availableModels: [{ id: "gpt-5.5", label: "GPT", providerId: "codex" }],
    hostLabel: "Computer",
    isConnected: true,
    onBack: vi.fn(),
    onCreate: createThread,
    onLoadModels: async () => {},
    onLoadComposerCommands: load,
    modelCatalog: { loading: false },
    projects: [{ id: "project", name: "Project", kind: "repo", threads: [] }],
  };
  await act(async () => {
    renderer = create(createElement(NewChatScreen, props));
  });
  const composer = () => renderer.root.findByType("Composer" as never);
  await act(async () => composer().props.onDraftChange("/"));
  expect(load).toHaveBeenCalledWith({
    projectId: "project",
    providerId: "codex",
    interactionMode: "default",
  });
  expect(createThread).not.toHaveBeenCalled();
  await act(async () => composer().props.onDraftChange("/audit"));
  expect(load).toHaveBeenCalledTimes(1);
  const skill = renderer.root.findByProps({ accessibilityLabel: "/review: Review code" });
  await act(async () => skill.props.onPress());
  expect(composer().props.draft).toBe("/review ");
  await act(async () => composer().props.onDraftChange("/review Fix startup"));
  await act(async () => composer().props.onSend());
  expect(createThread).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: "project",
      text: "/review Fix startup",
      composer: expect.objectContaining({
        skills: [{ name: "review", displayName: "Code audit" }],
      }),
    }),
  );
});

it("refreshes the draft menu when its provider changes and ignores an old discovery response", async () => {
  let finishOld!: (commands: unknown[]) => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValue([{ name: "new-skill", description: "New provider", kind: "skill" }]);
  const models = [
    { id: "one", label: "One", providerId: "codex" },
    { id: "two", label: "Two", providerId: "claudeAgent" },
  ];
  await act(async () => {
    renderer = create(
      createElement(NewChatScreen, {
        availableModels: models,
        hostLabel: "Computer",
        isConnected: true,
        onBack: vi.fn(),
        onCreate: async () => ({ sent: false }),
        onLoadModels: async () => {},
        onLoadComposerCommands: load,
        modelCatalog: { loading: false },
        projects: [{ id: "project", name: "Project", kind: "repo", threads: [] }],
      }),
    );
  });
  const composer = () => renderer.root.findByType("Composer" as never);
  await act(async () => composer().props.onDraftChange("/"));
  await act(async () => composer().props.menuConfig.onSelectModel(models[1]));
  await act(async () =>
    finishOld([{ name: "old-skill", description: "Old provider", kind: "skill" }]),
  );
  expect(load).toHaveBeenLastCalledWith({
    projectId: "project",
    providerId: "claudeAgent",
    interactionMode: "default",
  });
  expect(
    renderer.root.findAllByProps({ accessibilityLabel: "/old-skill: Old provider" }),
  ).toHaveLength(0);
  expect(
    renderer.root.findAllByProps({ accessibilityLabel: "/new-skill: New provider" }),
  ).toHaveLength(1);
});
