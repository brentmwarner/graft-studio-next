import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, View, useColorScheme } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useGraftPalette } from "../theme/tokens";

/// Soft stand-in for the native Metal `onboardingRibbon` — Expo cannot host
/// that shader without a custom module. The bands keep the welcome ground
/// from reading as a flat slab while liquid glass sits on top.
export function OnboardingRibbon() {
  const palette = useGraftPalette();
  const scheme = useColorScheme();
  const dark = scheme === "dark";
  const [reduceMotion, setReduceMotion] = useState(false);
  const drift = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      drift.value = 0;
      return;
    }
    drift.value = withRepeat(
      withTiming(1, { duration: 14000, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [drift, reduceMotion]);

  const shift = useAnimatedStyle(() => ({
    transform: [{ translateY: (drift.value - 0.5) * 36 }],
  }));

  const wash = dark
    ? (["rgba(255,255,255,0.07)", "rgba(255,255,255,0.00)", "rgba(255,255,255,0.04)"] as const)
    : (["rgba(0,0,0,0.05)", "rgba(0,0,0,0.00)", "rgba(0,0,0,0.03)"] as const);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: palette.background }]}
    >
      <Animated.View style={[styles.sheet, shift]}>
        <LinearGradient
          colors={[...wash]}
          end={{ x: 0.85, y: 1 }}
          start={{ x: 0.15, y: 0 }}
          style={styles.bandA}
        />
        <LinearGradient
          colors={[wash[2], wash[1], wash[0]]}
          end={{ x: 0.2, y: 1 }}
          start={{ x: 0.9, y: 0 }}
          style={styles.bandB}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  bandA: {
    ...StyleSheet.absoluteFill,
    height: "70%",
    top: "8%",
  },
  bandB: {
    ...StyleSheet.absoluteFill,
    height: "55%",
    top: "38%",
  },
  sheet: {
    flex: 1,
  },
});
