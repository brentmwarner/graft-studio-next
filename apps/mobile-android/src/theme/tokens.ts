import { Platform, useColorScheme } from "react-native";

/// Mobile palette tracks the Hermes / iOS design system: monochrome chrome,
/// no chromatic CTA. Status hues (`success` / `info` / `warning` / `danger`)
/// appear only in data and feedback — badges, diffs, links, errors.
export interface GraftPalette {
  readonly isDark: boolean;
  readonly background: string;
  readonly elevated: string;
  readonly subtle: string;
  readonly muted: string;
  readonly foreground: string;
  readonly foregroundMuted: string;
  readonly foregroundSubtle: string;
  readonly border: string;
  readonly floatingSurface: string;
  readonly fadeMid: string;
  readonly bubble: string;
  readonly code: string;
  readonly scrim: string;
  /// Primary action fill — the neutral foreground. Not a brand blue.
  readonly accent: string;
  /// Ink on top of `accent`.
  readonly accentFg: string;
  readonly success: string;
  /// Links and attention markers only — never chrome or CTAs.
  readonly info: string;
  readonly warning: string;
  readonly danger: string;
  /// Diff line tints. Semantic — they mean added and removed, not good and
  /// bad — and are the one place green is intentional.
  readonly diffAddBackground: string;
  readonly diffRemoveBackground: string;
  readonly diffAddEmphasis: string;
  readonly diffRemoveEmphasis: string;
}

const light: GraftPalette = {
  isDark: false,
  background: "#FFFFFF",
  elevated: "#FFFFFF",
  subtle: "#F4F4F5",
  muted: "#E9E9EB",
  foreground: "#09090B",
  foregroundMuted: "#3F3F46",
  foregroundSubtle: "#71717A",
  border: "rgba(9, 9, 11, 0.08)",
  floatingSurface: "rgba(255, 255, 255, 0.96)",
  fadeMid: "rgba(255, 255, 255, 0.72)",
  bubble: "#F1F1F3",
  code: "#F4F4F5",
  scrim: "rgba(0, 0, 0, 0.25)",
  accent: "#09090B",
  accentFg: "#FFFFFF",
  success: "#1F7A4D",
  info: "#1A56DB",
  warning: "#B45309",
  danger: "#B42318",
  diffAddBackground: "rgba(31, 122, 77, 0.10)",
  diffRemoveBackground: "rgba(180, 35, 24, 0.10)",
  diffAddEmphasis: "rgba(31, 122, 77, 0.18)",
  diffRemoveEmphasis: "rgba(180, 35, 24, 0.18)",
};

const dark: GraftPalette = {
  isDark: true,
  background: "#050505",
  elevated: "#111113",
  subtle: "#19191C",
  muted: "#2A2A2D",
  foreground: "#FFFFFF",
  foregroundMuted: "rgba(255, 255, 255, 0.74)",
  foregroundSubtle: "rgba(255, 255, 255, 0.55)",
  border: "rgba(255, 255, 255, 0.10)",
  floatingSurface: "rgba(20, 20, 22, 0.96)",
  fadeMid: "rgba(5, 5, 5, 0.72)",
  bubble: "#1C1C1F",
  code: "#18181B",
  scrim: "rgba(0, 0, 0, 0.56)",
  accent: "#FFFFFF",
  accentFg: "#09090B",
  success: "#5EE6A3",
  info: "#7FB4FF",
  warning: "#E0C46C",
  danger: "#E37070",
  diffAddBackground: "rgba(94, 230, 163, 0.12)",
  diffRemoveBackground: "rgba(227, 112, 112, 0.12)",
  diffAddEmphasis: "rgba(94, 230, 163, 0.24)",
  diffRemoveEmphasis: "rgba(227, 112, 112, 0.24)",
};

export const graftSpacing = {
  half: 4,
  one: 8,
  two: 16,
  three: 24,
  four: 32,
} as const;

export const graftRadius = {
  small: 10,
  medium: 14,
  large: 20,
  bubble: 22,
  composer: 24,
  sheet: 28,
  pill: 999,
} as const;

/// Native iOS `DS.Color` — exact Hermes tokens so Expo chrome matches SwiftUI.
const iosLight: GraftPalette = {
  ...light,
  subtle: "#F5F5F7",
  muted: "#F5F5F7",
  foreground: "#000000",
  foregroundMuted: "#303030",
  foregroundSubtle: "#6E6E73",
  border: "#E5E5EA",
  accent: "#000000",
};

const iosDark: GraftPalette = {
  ...dark,
  background: "#000000",
  elevated: "#0E0E0F",
  subtle: "#141416",
  muted: "#303030",
  fadeMid: "rgba(0, 0, 0, 0.72)",
};

export function useGraftPalette(): GraftPalette {
  const isDark = useColorScheme() === "dark";
  if (Platform.OS === "ios") return isDark ? iosDark : iosLight;
  return isDark ? dark : light;
}
