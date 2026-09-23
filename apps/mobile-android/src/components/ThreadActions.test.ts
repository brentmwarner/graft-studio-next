import { createElement, useState, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

import { ThreadActions } from "./ThreadActions";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  pan: {} as Record<string, (...args: unknown[]) => unknown>,
}));
vi.mock("react-native", () => ({
  Alert: { alert: mocks.alert },
  View: "View",
  Text: "Text",
  TextInput: "TextInput",
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  PanResponder: {
    create: (handlers: typeof mocks.pan) => {
      mocks.pan = handlers;
      return { panHandlers: {} };
    },
  },
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: () => ({}),
  withTiming: (value: number) => value,
}));
vi.mock("../theme/tokens", () => ({ useGraftPalette: () => ({}) }));
vi.mock("./BottomSheet", () => ({
  BottomSheet: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? children : null,
}));
vi.mock("./AnchoredMenu", () => ({
  AnchoredMenu: ({
    trigger,
    children,
  }: {
    trigger: (open: () => void) => ReactNode;
    children: (close: () => void) => ReactNode;
  }) => {
    const [open, setOpen] = useState(false);
    return createElement(
      "Menu",
      null,
      trigger(() => setOpen(true)),
      open ? children(() => setOpen(false)) : null,
    );
  },
  MenuItem: "MenuItem",
}));

let renderer: ReactTestRenderer;
const thread = { id: "computer/thread", title: "Original title", activity: "idle" as const };
const onAction = vi.fn();
const onOpen = vi.fn();
async function render() {
  onAction.mockReset().mockResolvedValue(undefined);
  onOpen.mockClear();
  mocks.alert.mockClear();
  await act(async () => {
    renderer = create(createElement(ThreadActions, { thread, onAction, onOpen, children: "Chat" }));
  });
}
function row() {
  return renderer.root.findByProps({ accessibilityLabel: thread.title });
}
function menu(label: string) {
  return renderer.root.findByProps({ label });
}
afterEach(async () => {
  await act(async () => renderer?.unmount());
});

it("leaves vertical scrolling alone and reveals actions only for a horizontal swipe", async () => {
  await render();
  expect(mocks.pan.onMoveShouldSetPanResponder!(null, { dx: -20, dy: 50 })).toBe(false);
  expect(mocks.pan.onMoveShouldSetPanResponder!(null, { dx: -60, dy: 5 })).toBe(true);
  await act(async () => {
    mocks.pan.onPanResponderGrant!();
    mocks.pan.onPanResponderRelease!(null, { dx: -160, dy: 5 });
  });
  expect(renderer.root.findByProps({ accessibilityLabel: "Archive chat" })).toBeDefined();
  expect(renderer.root.findByProps({ accessibilityLabel: "Delete chat" })).toBeDefined();
  expect(onAction).not.toHaveBeenCalled();
  expect(onOpen).not.toHaveBeenCalled();
});

it("renames through the long-press menu without opening the thread", async () => {
  await render();
  await act(async () => row().props.onLongPress());
  await act(async () => menu("Rename").props.onPress());
  await act(async () =>
    renderer.root
      .findByProps({ accessibilityLabel: "Chat title" })
      .props.onChangeText("  Updated title  "),
  );
  await act(async () =>
    renderer.root.findByProps({ accessibilityLabel: "Chat title" }).props.onSubmitEditing(),
  );
  expect(onAction).toHaveBeenCalledWith(thread, "rename", "Updated title");
  expect(onOpen).not.toHaveBeenCalled();
});

it.each(["long press", "swipe"])(
  "requires confirmation before deletion via %s and surfaces host failures",
  async (entry) => {
    await render();
    onAction.mockRejectedValueOnce(new Error("Computer offline"));
    if (entry === "swipe") {
      await act(async () => {
        mocks.pan.onPanResponderGrant!();
        mocks.pan.onPanResponderRelease!(null, { dx: -160, dy: 5 });
      });
      await act(async () =>
        renderer.root.findByProps({ accessibilityLabel: "Delete chat" }).props.onPress(),
      );
    } else {
      await act(async () => row().props.onLongPress());
      await act(async () => menu("Delete").props.onPress());
    }
    expect(onAction).not.toHaveBeenCalled();
    const buttons = mocks.alert.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((button) => button.text === "Delete")!.onPress!());
    expect(onAction).toHaveBeenCalledWith(thread, "delete", undefined);
    expect(mocks.alert).toHaveBeenLastCalledWith("Could not update chat", "Computer offline");
  },
);
