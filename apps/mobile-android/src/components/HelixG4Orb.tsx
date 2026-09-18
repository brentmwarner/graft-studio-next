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
  HELIX_G4_CYCLE,
  HELIX_G4_DOT_DIAMETER,
  HELIX_G4_DOTS_PER_RING,
  HELIX_G4_KEYFRAMES,
  HELIX_G4_LATITUDES,
  HELIX_G4_STAGE,
  helixG4DotPoses,
  type HelixG4Dot,
} from "./helixG4";

const LIVE_STATUS_ORB_SIZE = 26;
const LOOP_MS = HELIX_G4_CYCLE * 1000;

/** AICSS G4 helix/globe used as Graft's thinking / composing indicator. */
export const HelixG4Orb = memo(function HelixG4Orb({
  size = LIVE_STATUS_ORB_SIZE,
}: {
  readonly size?: number;
}) {
  const palette = useGraftPalette();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(progress);
    if (reduceMotion) {
      progress.value = 0;
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, {
        duration: LOOP_MS,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion]);

  const scale = size / HELIX_G4_STAGE;
  const radius = Math.max(0.35, (HELIX_G4_DOT_DIAMETER * scale) / 2);
  const center = size / 2;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: size, width: size }}
    >
      {HELIX_G4_LATITUDES.flatMap((_, ring) =>
        Array.from({ length: HELIX_G4_DOTS_PER_RING }, (__, spoke) => (
          <HelixG4DotView
            center={center}
            color={palette.foreground}
            key={`${ring}:${spoke}`}
            poses={helixG4DotPoses(ring, spoke)}
            progress={progress}
            radius={radius}
            reduceMotion={reduceMotion}
            scale={scale}
          />
        )),
      )}
    </View>
  );
});

function interpolateHelixDot(poses: readonly HelixG4Dot[], progress: number): HelixG4Dot {
  "worklet";
  let wrapped = progress % 1;
  if (wrapped < 0) wrapped += 1;
  const frames = HELIX_G4_KEYFRAMES;
  let index = 0;
  while (index + 1 < frames.length && (frames[index + 1]?.time ?? 0) <= wrapped) {
    index += 1;
  }
  const start = frames[index];
  const end = frames[index + 1];
  const from = start?.pose ?? 0;
  const to = end?.pose ?? 0;
  const span = end && start ? end.time - start.time : 0;
  const fraction = !end || span <= 1e-12 ? 0 : (wrapped - (start?.time ?? 0)) / span;
  const a = poses[from];
  const b = poses[to] ?? a;
  if (!a) return { x: 0, y: 0, z: 0, opacity: 0 };
  if (!b) return a;
  return {
    x: a.x + (b.x - a.x) * fraction,
    y: a.y + (b.y - a.y) * fraction,
    z: a.z + (b.z - a.z) * fraction,
    opacity: a.opacity + (b.opacity - a.opacity) * fraction,
  };
}

const HelixG4DotView = memo(function HelixG4DotView({
  center,
  color,
  poses,
  progress,
  radius,
  reduceMotion,
  scale,
}: {
  readonly center: number;
  readonly color: string;
  readonly poses: readonly HelixG4Dot[];
  readonly progress: SharedValue<number>;
  readonly radius: number;
  readonly reduceMotion: boolean;
  readonly scale: number;
}) {
  const style = useAnimatedStyle(() => {
    const dot = interpolateHelixDot(poses, reduceMotion ? 0 : progress.value);
    return {
      left: center + dot.x * scale - radius,
      opacity: dot.opacity,
      top: center + dot.y * scale - radius,
    };
  });

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          backgroundColor: color,
          height: radius * 2,
          width: radius * 2,
        },
        style,
      ]}
    />
  );
});

const styles = StyleSheet.create({
  dot: {
    borderRadius: 999,
    position: "absolute",
  },
});
