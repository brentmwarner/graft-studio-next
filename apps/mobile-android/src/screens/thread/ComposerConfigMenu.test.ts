import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ComposerConfigMenu,
  type ComposerMenuConfig,
  type ComposerMenuPage,
} from "./ComposerConfigMenu";

const close = vi.hoisted(() => vi.fn());
vi.mock("../../components/AnchoredMenu", () => ({
  AnchoredMenu: ({ children }: { children: (close: () => void) => ReactNode }) => children(close),
  MenuCaption: "Caption",
  MenuItem: "Item",
}));
const model = { id: "codex", providerId: "codex", label: "Codex" };
let renderer: ReactTestRenderer | undefined;
let config: ComposerMenuConfig;
const isType = (node: { type: unknown }, name: string) => node.type === name;
const items = () => renderer!.root.findAll((node) => isType(node, "Item"));
const item = (label: string) => items().find((node) => node.props.label === label)!;
async function mount(page: ComposerMenuPage) {
  await act(() => {
    renderer = create(
      createElement(ComposerConfigMenu, {
        config,
        initialPage: page,
        trigger: () => createElement("Trigger"),
      }),
    );
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  close.mockClear();
  config = {
    currentApproval: "ask",
    approvalOptions: [
      { value: "ask", label: "Ask first" },
      { value: "full", label: "Full access" },
    ],
    currentModel: model,
    models: [model, { ...model, providerId: "other", label: "Other Codex" }],
    efforts: ["high", "low"],
    resolvedEffort: "high",
    enabled: true,
    onSelectApproval: vi.fn(() => true),
    onSelectModel: vi.fn(() => true),
    onSelectEffort: vi.fn(),
  };
});
afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("composer quick menus", () => {
  it("opens models directly for an existing chat and omits provider navigation", async () => {
    config = { ...config, lockedProviderId: "codex" };
    await mount("providers");
    expect(items().map((node) => node.props.label)).toContain("Codex");
    expect(items().map((node) => node.props.label)).not.toContain("‹ Providers");
    expect(items().map((node) => node.props.label)).not.toContain("Other Codex");
  });
  it("goes straight from effort to models when the provider is locked", async () => {
    config = { ...config, lockedProviderId: "codex" };
    await mount("intelligence");
    await act(() => item("Model").props.onPress());
    expect(items().map((node) => node.props.label)).toEqual(["Codex"]);
  });
  it("selects an effort and closes without opening a sheet", async () => {
    await mount("intelligence");
    expect(item("High").props.selected).toBe(true);
    await act(async () => item("Low").props.onPress());
    expect(config.onSelectEffort).toHaveBeenCalledWith("low");
    expect(close).toHaveBeenCalledOnce();
  });
  it("keeps the current permission on failure and allows retry", async () => {
    config = {
      ...config,
      onSelectApproval: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
    };
    await mount("permissions");
    await act(async () => item("Full access").props.onPress());
    expect(close).not.toHaveBeenCalled();
    expect(item("Ask first").props.selected).toBe(true);
    expect(JSON.stringify(renderer!.toJSON())).toContain("Couldn’t apply this change");
    await act(async () => item("Full access").props.onPress());
    expect(close).toHaveBeenCalledOnce();
  });
  it("prevents duplicate requests while the host applies a selection", async () => {
    let finish!: (value: boolean) => void;
    const select = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    config = { ...config, onSelectApproval: select };
    await mount("permissions");
    await act(() => {
      item("Full access").props.onPress();
      item("Full access").props.onPress();
    });
    expect(select).toHaveBeenCalledOnce();
    expect(items().every((node) => node.props.enabled === false)).toBe(true);
    await act(async () => finish(true));
    expect(close).toHaveBeenCalledOnce();
  });
  it("distinguishes identical model IDs from different providers", async () => {
    await mount("providers");
    expect(item("codex").props.selected).toBe(true);
    await act(() => item("other").props.onPress());
    expect(items().some((node) => node.props.label === "Codex")).toBe(false);
    expect(item("Other Codex").props.selected).toBe(false);
    await act(async () => item("Other Codex").props.onPress());
    expect(config.onSelectModel).toHaveBeenCalledWith(config.models[1]);
    expect(close).toHaveBeenCalledOnce();
  });
  it("disables host settings while disconnected", async () => {
    config = { ...config, enabled: false };
    await mount("permissions");
    expect(items().every((node) => node.props.enabled === false)).toBe(true);
    await act(async () => item("Full access").props.onPress());
    expect(config.onSelectApproval).not.toHaveBeenCalled();
  });
});

it("opens each native picker from plus and keeps model settings in their own menu", async () => {
  config = {
    ...config,
    extras: {
      attachmentsEnabled: true,
      modesEnabled: true,
      fastModeEnabled: true,
      interactionMode: "default",
      fastMode: false,
      busy: false,
      onAttach: vi.fn(),
      onSelectMode: vi.fn(),
      onSelectFastMode: vi.fn(),
    },
  };
  await mount("options");
  expect(items().map((node) => node.props.label)).toEqual([
    "Add files",
    "Photos",
    "Camera",
    "Mode",
  ]);
  for (const [label, source] of [
    ["Add files", "files"],
    ["Photos", "photos"],
    ["Camera", "camera"],
  ]) {
    await act(() => item(label!).props.onPress());
    expect(config.extras!.onAttach).toHaveBeenLastCalledWith(source);
  }
  expect(close).toHaveBeenCalledTimes(3);
});

it("selects Plan and Fast from the plus menu", async () => {
  config = {
    ...config,
    currentModel: { ...model, supportsFastMode: true },
    extras: {
      attachmentsEnabled: true,
      modesEnabled: true,
      fastModeEnabled: true,
      interactionMode: "default",
      fastMode: false,
      busy: false,
      onAttach: vi.fn(),
      onSelectMode: vi.fn(),
      onSelectFastMode: vi.fn(),
    },
  };
  await mount("options");
  await act(() => item("Mode").props.onPress());
  expect(item("Default").props.selected).toBe(true);
  await act(() => item("Plan").props.onPress());
  expect(config.extras!.onSelectMode).toHaveBeenCalledWith("plan");
  await act(() => item("‹ Composer options").props.onPress());
  await act(() => item("Speed").props.onPress());
  await act(() => item("Fast").props.onPress());
  expect(config.extras!.onSelectFastMode).toHaveBeenCalledWith(true);
});

it("allows local attachments before host support arrives and explains the send requirement", async () => {
  config = {
    ...config,
    enabled: false,
    extras: {
      attachmentsEnabled: false,
      modesEnabled: false,
      fastModeEnabled: false,
      interactionMode: "default",
      fastMode: false,
      busy: false,
      onAttach: vi.fn(),
      onSelectMode: vi.fn(),
      onSelectFastMode: vi.fn(),
    },
  };
  await mount("options");
  expect(item("Add files").props.enabled).toBe(true);
  await act(() => item("Add files").props.onPress());
  expect(config.extras!.onAttach).toHaveBeenCalledWith("files");
  expect(JSON.stringify(renderer!.toJSON())).toContain("Reconnect to an updated Studio");
});

it("exposes catalog recovery even when no models have loaded", async () => {
  config = {
    ...config,
    models: [],
    catalog: { loading: false, error: "Couldn’t load models." },
    onReloadModels: vi.fn(),
  };
  await mount("providers");
  expect(JSON.stringify(renderer!.toJSON())).toContain("Couldn’t load models.");
  await act(() => item("Retry loading models").props.onPress());
  expect(config.onReloadModels).toHaveBeenCalledOnce();
});
