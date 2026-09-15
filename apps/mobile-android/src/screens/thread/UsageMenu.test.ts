import type { GraftThreadUsage } from "@graft/mobile-contract";
import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { GatewayError } from "../../api/gateway";
import { UsageMenu } from "./UsageMenu";

vi.mock("expo/fetch", () => ({ fetch: globalThis.fetch }));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
vi.mock("@expo/ui/jetpack-compose", () => ({ Host: "Host", LinearProgressIndicator: "Bar" }));
vi.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  fillMaxWidth: () => ({}),
  height: () => ({}),
}));
vi.mock("../../theme/tokens", () => ({ useGraftPalette: () => ({}) }));
vi.mock("../../components/AnchoredMenu", () => ({
  AnchoredMenu: ({
    children,
    onOpenChange,
  }: {
    children: (close: () => void) => ReactNode;
    onOpenChange: (open: boolean) => void;
  }) =>
    createElement(
      "Popup",
      { onOpenChange },
      children(() => onOpenChange(false)),
    ),
  MenuCaption: "Caption",
  MenuItem: "Item",
}));
let renderer: ReactTestRenderer | undefined;
const content = () => JSON.stringify(renderer!.toJSON());
const changeOpen = (open: boolean) =>
  renderer!.root.find((node) => node.type === "Popup").props.onOpenChange(open);
const response = (remainingPercent: number): GraftThreadUsage => ({
  threadId: "a",
  allowance: {
    providerId: "codex",
    stale: false,
    status: "ok",
    limits: [{ label: "Weekly", remainingPercent }],
  },
});
async function mount(onLoadUsage: (threadId: string) => Promise<GraftThreadUsage>) {
  await act(() => {
    renderer = create(
      createElement(UsageMenu, {
        threadId: "a",
        contextUsage: undefined,
        trigger: () => createElement("Trigger"),
        onLoadUsage,
      }),
    );
  });
}
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("loads allowance only when opened and never invents context usage", async () => {
  const load = vi.fn(async () => response(64));
  await mount(load);
  expect(load).not.toHaveBeenCalled();
  await act(async () => changeOpen(true));
  expect(content()).toContain("64% remaining");
  expect(content()).toContain("Not reported");
  expect(content()).not.toContain("0% used");
});
it("ignores an earlier opening's late response", async () => {
  const requests: Array<(usage: GraftThreadUsage) => void> = [];
  await mount(() => new Promise((resolve) => requests.push(resolve)));
  await act(() => changeOpen(true));
  await act(() => changeOpen(false));
  await act(() => changeOpen(true));
  await act(async () => requests[1]!(response(75)));
  await act(async () => requests[0]!(response(10)));
  expect(content()).toContain("75% remaining");
  expect(content()).not.toContain("10% remaining");
});
it("shows the legacy host fallback instead of an empty meter", async () => {
  await mount(async () => {
    throw new GatewayError("Not found", "invalid_response", 404);
  });
  await act(async () => changeOpen(true));
  expect(content()).toContain("Account usage isn’t available on this host yet.");
  expect(renderer!.root.findAll((node) => node.type === "Bar")).toHaveLength(0);
});
