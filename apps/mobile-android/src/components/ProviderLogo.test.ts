import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ProviderLogo } from "./ProviderLogo";

vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  Image: "Image",
  View: "View",
}));
vi.mock("react-native-svg", () => ({
  default: "Svg",
  Path: "Path",
}));
vi.mock("../theme/tokens", () => ({
  useGraftPalette: () => ({ subtle: "#19191C", foreground: "black", foregroundMuted: "grey" }),
}));

let renderer: ReactTestRenderer | undefined;

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

const isType = (node: { type: unknown }, name: string) => node.type === name;

it.each(["claudeAgent", "claude"])("preserves Claude orange for %s", async (providerId) => {
  await act(() => {
    renderer = create(createElement(ProviderLogo, { providerId }));
  });
  expect(renderer!.root.find((node) => isType(node, "Path")).props.fill).toBe("#D97757");
});

it("uses full contrast for monochrome provider marks", async () => {
  await act(() => {
    renderer = create(createElement(ProviderLogo, { providerId: "codex" }));
  });
  expect(renderer!.root.find((node) => isType(node, "Path")).props.fill).toBe("black");
});

it("keeps all four Google brand colors", async () => {
  await act(() => {
    renderer = create(createElement(ProviderLogo, { providerId: "google" }));
  });
  expect(
    renderer!.root.findAll((node) => isType(node, "Path")).map((node) => node.props.fill),
  ).toEqual(["#FFC107", "#FF3D00", "#4CAF50", "#1976D2"]);
});

it("renders the original Antigravity artwork without a tint", async () => {
  await act(() => {
    renderer = create(createElement(ProviderLogo, { providerId: "antigravity" }));
  });
  const image = renderer!.root.find((node) => isType(node, "Image"));
  expect(image.props.source).toBeTruthy();
  expect(image.props.style.tintColor).toBeUndefined();
});

it("renders the Anthropic mark with iOS tile colors on the dark chip", async () => {
  await act(() => {
    renderer = create(createElement(ProviderLogo, { providerId: "anthropic", label: "Anthropic" }));
  });
  const tile = renderer!.root.find((node) => isType(node, "View"));
  expect(tile.props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ backgroundColor: "#D77655" })]),
  );
  expect(
    renderer!.root.findAll((node) => isType(node, "Path")).map((node) => node.props.fill),
  ).toEqual(["#FCF2EE"]);
});
