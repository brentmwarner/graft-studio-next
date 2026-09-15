import { memo, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useGraftPalette } from "../theme/tokens";

/** A lightweight iOS rendering of the native welcome ribbon's slow metallic flow. */
export const WelcomeRibbon = memo(function WelcomeRibbon() {
  const palette = useGraftPalette();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    if (!reduceMotion) {
      progress.value = withRepeat(
        withTiming(1, { duration: 8_000, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
    }
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion]);

  const first = useAnimatedStyle(() => ({
    opacity: 0.13 + progress.value * 0.08,
    transform: [
      { translateX: -42 + progress.value * 58 },
      { translateY: -18 + progress.value * 24 },
      { rotateZ: "-31deg" },
    ],
  }));
  const second = useAnimatedStyle(() => ({
    opacity: 0.08 + (1 - progress.value) * 0.08,
    transform: [
      { translateX: 40 - progress.value * 46 },
      { translateY: 38 - progress.value * 20 },
      { rotateZ: "34deg" },
    ],
  }));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: palette.background }]}
    >
      <Animated.View
        style={[styles.ribbon, styles.first, { backgroundColor: palette.foreground }, first]}
      />
      <Animated.View
        style={[styles.ribbon, styles.second, { backgroundColor: palette.foreground }, second]}
      />
      <View style={[styles.wash, { backgroundColor: palette.background }]} />
    </View>
  );
});

const styles = StyleSheet.create({
  ribbon: { borderRadius: 160, position: "absolute" },
  first: { height: 145, left: -100, top: "17%", width: "145%" },
  second: { height: 98, left: -70, top: "46%", width: "135%" },
  wash: { bottom: 0, height: "22%", left: 0, opacity: 0.62, position: "absolute", right: 0 },
});
