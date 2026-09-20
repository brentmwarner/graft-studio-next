import type { GraftEnvironmentSnapshot, GraftSessionCredential } from "@graft/mobile-contract";
import { createElement, useState, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { machineInbox } from "../state/machineInbox";
import { HomeScreen } from "./HomeScreen";
import type { InboxViewMode } from "../state/inboxGrouping";

vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
  View: "View",
  ActivityIndicator: "ActivityIndicator",
  Text: "Text",
  TextInput: "TextInput",
  ScrollView: "ScrollView",
  RefreshControl: "RefreshControl",
  Pressable: ({
    children,
    ...props
  }: {
    children: ReactNode | ((state: { pressed: boolean }) => ReactNode);
  }) =>
    createElement(
      "Pressable",
      props,
      typeof children === "function" ? children({ pressed: false }) : children,
    ),
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24 }),
}));
vi.mock("../theme/tokens", () => ({
  useGraftPalette: () => ({}),
  graftSpacing: {},
  graftRadius: {},
}));
vi.mock("../components/CircleIconButton", () => ({ CircleIconButton: "CircleButton" }));
vi.mock("../components/EdgeFade", () => ({ EdgeFade: "Fade" }));
vi.mock("../components/FloatingSurface", () => ({ FloatingSurface: "Surface" }));
vi.mock("../components/PressScale", () => ({ PressScale: "PressScale" }));
vi.mock("../components/AnchoredMenu", () => ({
  AnchoredMenu: ({ children }: { children: (close: () => void) => ReactNode }) =>
    children(() => {}),
  MenuItem: "MenuItem",
}));

const snapshot: GraftEnvironmentSnapshot = {
  environment: {
    id: "mac",
    label: "Mac",
    hostVersion: "1",
    protocolVersion: 1,
    capabilities: [],
    cursor: 1,
  },
  projects: [
    { id: "graft", name: "Graft", kind: "repo" },
    { id: "chats", name: "Personal", kind: "desktop" },
    { id: "other", name: "Other app", kind: "repo" },
  ],
  threads: [
    { id: "chat", projectId: "chats", title: "Plan the weekend", updatedAt: Date.now() },
    {
      id: "a",
      projectId: "graft",
      title: "Review mobile",
      updatedAt: Date.now(),
      status: "running",
    },
    { id: "b", projectId: "other", title: "Polish desktop", updatedAt: Date.now() },
  ],
  activeRuns: [],
  pendingApprovals: [],
  pendingQuestions: [],
  selectedTranscript: null,
  cursor: 1,
};
const onNewChat = vi.fn();
const onOpenThread = vi.fn();
const onSettings = vi.fn();
let renderer: ReactTestRenderer;
function Harness() {
  const [viewMode, setViewMode] = useState<InboxViewMode>("project");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  return createElement(HomeScreen, {
    connectionState: "connected",
    isRefreshing: false,
    snapshot,
    session: { environmentLabel: "Mac" } as GraftSessionCredential,
    onNewChat,
    onOpenThread,
    onSettings,
    onOpenMenu: () => {},
    onRefresh: async () => {},
    viewMode,
    onViewModeChange: setViewMode,
    expandedProjectIds: expanded,
    onToggleProject: (id) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
  });
}
function find(type: string, props: Record<string, unknown>) {
  return renderer.root.find(
    (node) =>
      typeof node.type === "string" &&
      node.type === type &&
      Object.entries(props).every(([key, value]) => node.props[key] === value),
  );
}
function isHostType(node: { readonly type: unknown }, type: string) {
  return node.type === type;
}
function visible() {
  return renderer.root
    .findAll((node) => isHostType(node, "Text"))
    .map((node) => node.children.filter((child) => typeof child === "string").join(""))
    .join(" ");
}
async function press(type: string, props: Record<string, unknown>) {
  await act(() => find(type, props).props.onPress());
}
async function search(text: string) {
  await act(() =>
    find("TextInput", { accessibilityLabel: "Search chats" }).props.onChangeText(text),
  );
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(() => {
    renderer = create(createElement(Harness));
  });
});
afterEach(async () => {
  await act(() => renderer.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("starts collapsed, preserves manual expansion through view changes, and keeps compose separate", async () => {
  expect(visible()).not.toContain("Review mobile");
  await press("Pressable", { accessibilityLabel: "Graft" });
  expect(visible()).toContain("Review mobile");
  expect(visible()).not.toContain("Polish desktop");
  await press("PressScale", { accessibilityLabel: "New chat in Graft" });
  expect(onNewChat).toHaveBeenCalledWith("graft");
  await press("MenuItem", { label: "Chronological" });
  expect(visible()).toContain("Polish desktop");
  await press("MenuItem", { label: "By Project" });
  expect(visible()).toContain("Review mobile");
  expect(visible()).not.toContain("Polish desktop");
});

it("reveals matching threads in collapsed projects without persisting search expansion", async () => {
  await search("desktop");
  expect(visible()).toContain("Polish desktop");
  expect(visible()).not.toContain("Review mobile");
  await press("Pressable", { accessibilityHint: "Open thread" });
  expect(onOpenThread).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
  await search("");
  expect(visible()).not.toContain("Polish desktop");
  await search("nothing");
  expect(visible()).toContain("No matching chats");
});

it("offers all three views and settings, marks selection, and searches closed date groups", async () => {
  await press("MenuItem", { label: "Priority" });
  expect(find("MenuItem", { label: "Priority" }).props.selected).toBe(true);
  expect(visible()).toContain("Review mobile");
  await press("Pressable", { accessibilityLabel: "Priority" });
  expect(visible()).not.toContain("Review mobile");
  await search("mobile");
  expect(visible()).toContain("Review mobile");
  await press("MenuItem", { label: "Settings" });
  expect(onSettings).toHaveBeenCalledOnce();
  expect(
    renderer.root.findAll((node) => isHostType(node, "MenuItem")).map((node) => node.props.label),
  ).toEqual(["Priority", "By Project", "Chronological", "Settings"]);
});

it("shows standalone Chats without expanding repository folders", async () => {
  await act(async () => {
    renderer = create(createElement(Harness));
  });
  const root = renderer.root;
  const texts = root.findAllByType("Text" as never).map((node) => node.props.children);
  expect(texts).toContain("Chats");
  expect(texts).toContain("Plan the weekend");
  expect(texts).not.toContain("Review mobile");
  await act(async () => {
    root.findByProps({ accessibilityLabel: "New chat in Chats" }).props.onPress();
  });
  expect(onNewChat).toHaveBeenCalledWith("chats");
});

it("shows All and machine filters with offline status and an Add computer action", async () => {
  const add = vi.fn();
  function MachinesHarness() {
    const [filter, setFilter] = useState<string>();
    const sources = ["Mac", "Linux"].map((label) => ({
      session: { environmentId: label, environmentLabel: label } as GraftSessionCredential,
      snapshot: {
        ...snapshot,
        environment: { ...snapshot.environment, id: label },
        threads: snapshot.threads.map((thread) => ({
          ...thread,
          title: `${thread.title} on ${label}`,
        })),
      },
      connectionState: label === "Mac" ? ("connected" as const) : ("disconnected" as const),
      reads: {},
    }));
    const inbox = machineInbox(sources, filter);
    return createElement(HomeScreen, {
      connectionState: "connected",
      isRefreshing: false,
      snapshot: inbox.snapshot,
      reads: inbox.reads,
      session: sources[0]!.session,
      onNewChat,
      onOpenThread,
      onSettings,
      onOpenMenu: () => {},
      onRefresh: async () => {},
      viewMode: "project",
      onViewModeChange: () => {},
      expandedProjectIds: new Set<string>(),
      onToggleProject: () => {},
      machines: sources.map((source) => ({
        id: source.session.environmentId,
        label: source.session.environmentLabel,
        connected: source.connectionState === "connected",
      })),
      selectedMachineId: filter,
      onSelectMachine: setFilter,
      onAddMachine: add,
    });
  }
  await act(() => renderer.update(createElement(MachinesHarness)));
  expect(visible()).toContain("Plan the weekend on Mac");
  expect(visible()).toContain("Plan the weekend on Linux");
  await press("Pressable", { accessibilityLabel: "Linux, Offline" });
  expect(visible()).not.toContain("Plan the weekend on Mac");
  expect(visible()).toContain("Plan the weekend on Linux");
  expect(renderer.root.findAll((node) => isHostType(node, "ActivityIndicator"))).toHaveLength(0);
  expect(
    find("Pressable", { accessibilityLabel: "Linux, Offline" }).props.accessibilityState.selected,
  ).toBe(true);
  await press("Pressable", { accessibilityLabel: "All computers" });
  expect(visible()).toContain("Plan the weekend on Mac");
  await press("PressScale", { accessibilityLabel: "New chat in Chats" });
  expect(onNewChat).toHaveBeenLastCalledWith(undefined);
  await press("MenuItem", { label: "Add computer" });
  expect(add).toHaveBeenCalledOnce();
});
