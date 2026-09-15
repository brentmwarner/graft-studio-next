import { Platform } from "react-native";
import { isGlassEffectAPIAvailable } from "expo-glass-effect";

/// Ionicons names used by Expo chrome → SF Symbols on native iOS.
const IOS_SYSTEM_NAMES: Readonly<Record<string, string>> = {
  add: "plus",
  "arrow-down": "arrow.down",
  "chevron-back": "chevron.left",
  "create-outline": "square.and.pencil",
  "ellipsis-horizontal": "ellipsis",
  "git-branch-outline": "arrow.triangle.branch",
  "link-outline": "link",
  menu: "line.3.horizontal",
  "person-circle-outline": "person.crop.circle",
  search: "magnifyingglass",
  "settings-outline": "gearshape",
};

/// Liquid Glass is an iOS 26+ system material. Android keeps the existing
/// opaque floating surfaces. Tests stub `expo-glass-effect`.
export function canUseLiquidGlass(): boolean {
  return Platform.OS === "ios" && isGlassEffectAPIAvailable();
}

export function iosGlassCornerRadius(height: number): number {
  return height / 2;
}

export function iosSystemNameForIcon(name: string): string | undefined {
  return IOS_SYSTEM_NAMES[name];
}
