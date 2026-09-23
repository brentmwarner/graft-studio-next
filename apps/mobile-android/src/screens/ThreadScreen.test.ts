import { createElement, type ComponentProps } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ThreadScreen } from "./ThreadScreen";

const follow = vi.hoisted(() => ({ isAwayFromBottom: false, jumpToLatest: vi.fn() }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  FlatList: "FlatList",
  KeyboardAvoidingView: "Screen",
  RefreshControl: "RefreshControl",
  Text: "Text",
  View: "View",
  Keyboard: { dismiss: vi.fn() },
  Vibration: { vibrate: vi.fn() },
  Platform: { OS: "android" },
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24 }),
}));
vi.mock("../components/AnchoredMenu", () => ({ AnchoredMenu: () => null, MenuItem: "MenuItem" }));
vi.mock("../components/CircleIconButton", () => ({ CircleIconButton: "CircleIconButton" }));
vi.mock("../components/EdgeFade", () => ({ EdgeFade: "EdgeFade" }));
vi.mock("../components/FloatingSurface", () => ({ FloatingSurface: "Surface" }));
vi.mock("../components/LiveStatusLine", () => ({ LiveStatusLine: "LiveStatusLine" }));
vi.mock("../components/PressScale", () => ({ PressScale: "Press" }));
vi.mock("../components/TaskProgressPill", () => ({ TaskProgressPill: "TaskProgressPill" }));
vi.mock("../theme/tokens", () => ({ useGraftPalette: () => ({}) }));
vi.mock("./thread/Composer", () => ({ Composer: "Composer" }));
vi.mock("./thread/ContextProgressRing", () => ({ ContextProgressRing: "Ring" }));
vi.mock("./thread/DiffSheet", () => ({ DiffSheet: "DiffSheet" }));
vi.mock("./thread/SlashPalette", () => ({ SlashPalette: "SlashPalette" }));
vi.mock("./thread/ThreadDetailsMenu", () => ({ ThreadDetailsMenu: "ThreadDetailsMenu" }));
vi.mock("./thread/UsageMenu", () => ({ UsageMenu: "UsageMenu" }));
vi.mock("./thread/InteractionPrompts", () => ({
  ApprovalPrompt: "Approval",
  QuestionPrompt: "Question",
}));
vi.mock("./thread/TranscriptRow", () => ({
  renderTranscriptRow: vi.fn(),
  transcriptRowKey: vi.fn(),
  useReconciledTranscript: () => [],
}));
vi.mock("./thread/useComposerAttachments", () => ({
  useComposerAttachments: () => ({ attachments: [] }),
}));
vi.mock("./thread/useVoiceInput", () => ({ useVoiceInput: () => ({ isActive: false }) }));
vi.mock("./thread/useKeyboardVisibility", () => ({ useKeyboardVisibility: () => false }));
vi.mock("./thread/useStreamingHaptics", () => ({ useStreamingHaptics: vi.fn() }));
vi.mock("./thread/useTranscriptFollow", () => ({ useTranscriptFollow: () => follow }));

const props: ComponentProps<typeof ThreadScreen> = {
  availableModels: [],
  connectionState: "connected",
  isRefreshing: false,
  hostLabel: "Computer",
  liveEvents: [],
  onBack: vi.fn(),
  onCancel: async () => true,
  onLoadDiff: async () => {},
  onLoadDiffFile: async () => undefined,
  onLoadThreadDetails: vi.fn(),
  onRenameThread: vi.fn(),
  onLoadUsage: async () => ({
    threadId: "thread",
    allowance: { providerId: "codex", status: "unsupported", stale: false, limits: [] },
  }),
  onLoadComposerCommands: async () => [],
  onLoadModels: async () => {},
  modelCatalog: { loading: false },
  onRefresh: async () => {},
  onResolveApproval: async () => true,
  onResolveQuestion: async () => true,
  onSend: async () => true,
  onSetApproval: async () => true,
  onSetModel: async () => true,
  snapshot: null,
  projectName: "Project",
  thread: { id: "thread", projectId: "project", title: "Chat", updatedAt: 1 },
};
let renderer: ReactTestRenderer;
const isType = (node: { type: unknown }, type: string) => node.type === type;
const chrome = () =>
  renderer.root.find(
    (node) => isType(node, "View") && node.props.onLayout && Array.isArray(node.props.style),
  );
const transcript = () => renderer.root.find((node) => isType(node, "FlatList"));
const layoutTree = (node: ReactTestInstance): unknown => [
  node.type,
  node.props.style,
  node.children.map((child) => (typeof child === "string" ? child : layoutTree(child))),
];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  follow.isAwayFromBottom = false;
  follow.jumpToLatest.mockClear();
});
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "shows and hides the arrow without changing chrome or transcript spacing (diff: %s)",
  async (withDiff) => {
    const screenProps: ComponentProps<typeof ThreadScreen> = {
      ...props,
      diffSummary: withDiff
        ? {
            id: "diff",
            threadId: "thread",
            updatedAt: 1,
            title: "Changes",
            files: [{ path: "file.ts", status: "modified", additions: 38, deletions: 35 }],
          }
        : undefined,
    };
    await act(() => {
      renderer = create(createElement(ThreadScreen, screenProps));
    });
    await act(() =>
      chrome().props.onLayout({ nativeEvent: { layout: { height: withDiff ? 136 : 90 } } }),
    );
    const beforeChrome = layoutTree(chrome());
    const beforePadding = transcript().props.contentContainerStyle;
    for (const visible of [true, false]) {
      follow.isAwayFromBottom = visible;
      await act(() => renderer.update(createElement(ThreadScreen, screenProps)));
      expect(layoutTree(chrome())).toEqual(beforeChrome);
      expect(transcript().props.contentContainerStyle).toEqual(beforePadding);
      const arrows = renderer.root.findAll(
        (node) =>
          isType(node, "Press") && node.props.accessibilityLabel === "Jump to latest message",
      );
      expect(arrows).toHaveLength(visible ? 1 : 0);
      if (visible) {
        expect(arrows[0]!.parent?.type).toBe("Screen");
        await act(() => arrows[0]!.props.onPress());
        expect(follow.jumpToLatest).toHaveBeenCalledOnce();
      }
    }
  },
);
