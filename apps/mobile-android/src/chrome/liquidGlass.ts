import { isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Platform } from "react-native";

/** Liquid Glass is an iOS 26+ system material; Android keeps its existing surfaces. */
export function canUseLiquidGlass(): boolean {
  return Platform.OS === "ios" && isGlassEffectAPIAvailable();
}
