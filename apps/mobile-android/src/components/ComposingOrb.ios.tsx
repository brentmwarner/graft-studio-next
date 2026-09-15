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
  type SharedValue,
} from "react-native-reanimated";

import { useGraftPalette } from "../theme/tokens";
import {
  HELIX_G4_CYCLE_MS,
  HELIX_G4_DOT_DIAMETER,
  HELIX_G4_DOTS_PER_RING,
  HELIX_G4_LATITUDES,
  HELIX_G4_STAGE,
  helixG4DotPosition,
} from "./helixG4";

const OrbDot = memo(function OrbDot({
  color,
  progress,
  ring,
  scale,
  spoke,
}: {
  readonly color: string;
  readonly progress: SharedValue<number>;
  readonly ring: number;
  readonly scale: number;
  readonly spoke: number;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const dot = helixG4DotPosition(ring, spoke, progress.value);
    return {
      opacity: dot.opacity,
      transform: [{ translateX: dot.x * scale }, { translateY: dot.y * scale }],
      zIndex: Math.round(dot.z * 10),
    };
  });
  const diameter = Math.max(1.4, HELIX_G4_DOT_DIAMETER * scale);
  return (
    <Animated.View
      style={[
        styles.dot,
        {
          backgroundColor: color,
          borderRadius: diameter / 2,
          height: diameter,
          marginLeft: -diameter / 2,
          marginTop: -diameter / 2,
          width: diameter,
        },
        animatedStyle,
      ]}
    />
  );
});

/** Native iOS Graft's AICSS G4 helix/globe thinking indicator. */
export const ComposingOrb = memo(function ComposingOrb({ size = 20 }: { readonly size?: number }) {
  const palette = useGraftPalette();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const scale = size / HELIX_G4_STAGE;

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    if (!reduceMotion) {
      progress.value = withRepeat(
        withTiming(1, { duration: HELIX_G4_CYCLE_MS, easing: Easing.linear }),
        -1,
        false,
      );
    }
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.stage, { height: size, width: size }]}
    >
      {HELIX_G4_LATITUDES.flatMap((_latitude, ring) =>
        Array.from({ length: HELIX_G4_DOTS_PER_RING }, (_unused, spoke) => (
          <OrbDot
            color={palette.foregroundSubtle}
            key={`${ring}:${spoke}`}
            progress={progress}
            ring={ring}
            scale={scale}
            spoke={spoke}
          />
        )),
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  stage: { alignItems: "center", justifyContent: "center" },
  dot: { left: "50%", position: "absolute", top: "50%" },
});
