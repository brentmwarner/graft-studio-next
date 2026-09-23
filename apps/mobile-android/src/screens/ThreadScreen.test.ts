import { createElement, useState, type ComponentProps } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ThreadScreen } from "./ThreadScreen";

const follow = vi.hoisted(() => ({ isAwayFromBottom: false, jumpToLatest: vi.fn() }));
const lifecycle = vi.hoisted(() => ({
  state: "active",
  listeners: new Set<(state: string) => void>(),
}));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  AppState: {
    get currentState() {
      return lifecycle.state;
    },
    addEventListener: (_: string, listener: (state: string) => void) => {
      lifecycle.listeners.add(listener);
      return { remove: () => lifecycle.listeners.delete(listener) };
    },
  },
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
  lifecycle.state = "active";
});
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shows working-tree edits before a diff event or turn completion, then refreshes the final state", async () => {
  vi.useFakeTimers();
  let additions = 0;
  const readDiff = vi.fn(async () => ({
    id: "thread",
    threadId: "thread",
    title: "Changes",
    updatedAt: Date.now(),
    files: additions ? [{ path: "file.ts", status: "modified" as const, additions }] : [],
  }));
  function Harness({ working }: { working: boolean }) {
    const [diffSummary, setDiffSummary] =
      useState<ComponentProps<typeof ThreadScreen>["diffSummary"]>();
    const [loadDiff] = useState(() => async () => setDiffSummary(await readDiff()));
    return createElement(ThreadScreen, {
      ...props,
      thread: { ...props.thread, status: working ? "running" : "idle" },
      diffSummary,
      onLoadDiff: loadDiff,
    });
  }
  const diffPills = () =>
    renderer.root.findAll(
      (node) => isType(node, "Press") && node.props.accessibilityLabel?.startsWith("Changes:"),
    );
  await act(async () => {
    renderer = create(createElement(Harness, { working: true }));
  });
  expect(diffPills()).toHaveLength(0);
  additions = 12;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_100);
  });
  expect(diffPills()).toHaveLength(1);
  expect(diffPills()[0]!.props.accessibilityLabel).toContain("12 additions");
  additions = 25;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_100);
  });
  expect(diffPills()[0]!.props.accessibilityLabel).toContain("25 additions");
  additions = 0;
  await act(async () => renderer.update(createElement(Harness, { working: false })));
  expect(diffPills()).toHaveLength(0);
  const reads = readDiff.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(readDiff).toHaveBeenCalledTimes(reads);
});

it("pauses diff reads offline and in the background and stops when the thread closes", async () => {
  vi.useFakeTimers();
  const readDiff = vi.fn(async () => {});
  const screenProps: ComponentProps<typeof ThreadScreen> = {
    ...props,
    thread: { ...props.thread, status: "running" },
    onLoadDiff: readDiff,
  };
  await act(async () => {
    renderer = create(createElement(ThreadScreen, screenProps));
  });
  expect(readDiff).toHaveBeenCalledTimes(1);
  await act(async () => {
    lifecycle.state = "background";
    lifecycle.listeners.forEach((listener) => listener("background"));
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(readDiff).toHaveBeenCalledTimes(1);
  await act(async () => {
    lifecycle.state = "active";
    lifecycle.listeners.forEach((listener) => listener("active"));
  });
  expect(readDiff).toHaveBeenCalledTimes(2);
  await act(async () =>
    renderer.update(
      createElement(ThreadScreen, { ...screenProps, connectionState: "reconnecting" }),
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(readDiff).toHaveBeenCalledTimes(2);
  await act(async () => renderer.update(createElement(ThreadScreen, screenProps)));
  expect(readDiff).toHaveBeenCalledTimes(3);
  await act(() => renderer.unmount());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(readDiff).toHaveBeenCalledTimes(3);
  expect(lifecycle.listeners.size).toBe(0);
});

it("waits for a slow diff read before scheduling another", async () => {
  vi.useFakeTimers();
  let resolve: () => void = () => {};
  const readDiff = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  await act(async () => {
    renderer = create(
      createElement(ThreadScreen, {
        ...props,
        thread: { ...props.thread, status: "running" },
        onLoadDiff: readDiff,
      }),
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(readDiff).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(readDiff).toHaveBeenCalledTimes(2);
  await act(() => renderer.unmount());
  await act(async () => resolve());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(readDiff).toHaveBeenCalledTimes(2);
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
