import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComposerConfigMenu, type ComposerMenuConfig, type ComposerMenuPage } from "./ComposerConfigMenu";

const close = vi.hoisted(() => vi.fn());
vi.mock("../../components/AnchoredMenu", () => ({
  AnchoredMenu: ({ children }: { children: (close: () => void) => ReactNode }) => children(close),
  MenuCaption: "Caption",
  MenuItem: "Item",
}));
const model = { id: "codex", providerId: "codex", label: "Codex" };
let renderer: ReactTestRenderer | undefined;
let config: ComposerMenuConfig;
const items = () => renderer!.root.findAll((node) => node.type === "Item");
const item = (label: string) => items().find((node) => node.props.label === label)!;
async function mount(page: ComposerMenuPage) {
  await act(() => { renderer = create(createElement(ComposerConfigMenu, { config, initialPage: page, trigger: () => createElement("Trigger") })); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  close.mockClear();
  config = {
    currentApproval: "ask", approvalOptions: [{ value: "ask", label: "Ask first" }, { value: "full", label: "Full access" }],
    currentModel: model, models: [model, { ...model, providerId: "other", label: "Other Codex" }],
    efforts: ["high", "low"], resolvedEffort: "high", enabled: true,
    onSelectApproval: vi.fn(() => true), onSelectModel: vi.fn(() => true), onSelectEffort: vi.fn(),
  };
});
afterEach(async () => { if (renderer) await act(() => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

describe("composer quick menus", () => {
  it("selects an effort and closes without opening a sheet", async () => {
    await mount("intelligence");
    expect(item("High").props.selected).toBe(true);
    await act(async () => item("Low").props.onPress());
    expect(config.onSelectEffort).toHaveBeenCalledWith("low");
    expect(close).toHaveBeenCalledOnce();
  });
  it("keeps the current permission on failure and allows retry", async () => {
    config = { ...config, onSelectApproval: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) };
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
    const select = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    config = { ...config, onSelectApproval: select };
    await mount("permissions");
    await act(() => { item("Full access").props.onPress(); item("Full access").props.onPress(); });
    expect(select).toHaveBeenCalledOnce();
    expect(items().every((node) => node.props.enabled === false)).toBe(true);
    await act(async () => finish(true));
    expect(close).toHaveBeenCalledOnce();
  });
  it("distinguishes identical model IDs from different providers", async () => {
    await mount("models");
    expect(item("Codex").props.selected).toBe(true);
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
