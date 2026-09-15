import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

const isGlassEffectAPIAvailable = vi.fn(() => true);

vi.mock("expo-glass-effect", () => ({
  isGlassEffectAPIAvailable: () => isGlassEffectAPIAvailable(),
}));

import { canUseLiquidGlass, iosGlassCornerRadius, iosSystemNameForIcon } from "./liquidGlass";

afterEach(() => {
  isGlassEffectAPIAvailable.mockReset();
  isGlassEffectAPIAvailable.mockReturnValue(true);
});

describe("canUseLiquidGlass", () => {
  it("is true on iOS when the Glass Effect API exists", () => {
    expect(canUseLiquidGlass()).toBe(true);
  });

  it("is false when the runtime API is missing", () => {
    isGlassEffectAPIAvailable.mockReturnValue(false);
    expect(canUseLiquidGlass()).toBe(false);
  });

  it("maps a control height to a capsule radius", () => {
    expect(iosGlassCornerRadius(46)).toBe(23);
  });
});

describe("iosSystemNameForIcon", () => {
  it("maps toolbar Ionicons to SF Symbols used on native iOS", () => {
    expect(iosSystemNameForIcon("menu")).toBe("line.3.horizontal");
    expect(iosSystemNameForIcon("chevron-back")).toBe("chevron.left");
    expect(iosSystemNameForIcon("ellipsis-horizontal")).toBe("ellipsis");
    expect(iosSystemNameForIcon("create-outline")).toBe("square.and.pencil");
    expect(iosSystemNameForIcon("person-circle-outline")).toBe("person.crop.circle");
    expect(iosSystemNameForIcon("missing")).toBeUndefined();
  });
});
