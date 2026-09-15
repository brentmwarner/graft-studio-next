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

const RUN_LOADER_SIZE = 18;
const RUN_LOADER_DOT_SIZE = RUN_LOADER_SIZE * (2 / 14);
const RUN_LOADER_SPEED = 1.45;
const RUN_LOADER_LOOP_MS = 1_600 / RUN_LOADER_SPEED;
const RUN_LOADER_PATH = [
  0, 1, 2, 3, 4, 9, 14, 19, 24, 23, 22, 21, 20, 15, 10, 5,
] as const;
const RUN_LOADER_TAIL = [1, 0.82, 0.64, 0.46, 0.3, 0.18] as const;
const RUN_LOADER_BACK_TAIL = [0.38, 0.3, 0.22, 0.14] as const;
const RUN_LOADER_TWIST_INNER: Readonly<Record<number, number>> = {
  0: 6,
  4: 8,
  8: 18,
  12: 16,
};

function tailOpacity(distance: number, tail: readonly number[]): number {
  "worklet";
  return distance >= 0 && distance < tail.length ? (tail[distance] ?? 0) : 0;
}

/** Exact opacity choreography from desktop's `DotmSquare20`. */
export function runLoaderDotOpacity(
  index: number,
  headStep: number,
  reduceMotion: boolean,
): number {
  "worklet";
  const loopStep = RUN_LOADER_PATH.indexOf(
    index as (typeof RUN_LOADER_PATH)[number],
  );
  if (reduceMotion) {
    if (loopStep >= 0) return 0.48;
    return index === 12 ? 0.22 : 0.08;
  }

  let opacity = 0.08;
  if (loopStep >= 0) {
    const backHead = (headStep + RUN_LOADER_PATH.length / 2) % 16;
    const forward = (headStep - loopStep + 16) % 16;
    const backward = (backHead - loopStep + 16) % 16;
    opacity = Math.max(
      opacity,
      tailOpacity(forward, RUN_LOADER_TAIL),
      tailOpacity(backward, RUN_LOADER_BACK_TAIL),
    );
  }
  if (RUN_LOADER_TWIST_INNER[headStep] === index) {
    opacity = Math.max(opacity, 0.52);
  }
  if (index === 12 && headStep % 4 === 0) {
    opacity = Math.max(opacity, 0.55);
  }
  return Math.min(1, opacity);
}

/** Graft's 5×5 desktop run loader, kept compact beside the live phase. */
export const RunStatusDotMatrix = memo(function RunStatusDotMatrix() {
  const palette = useGraftPalette();
  const reduceMotion = useReducedMotion();
  const headStep = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(headStep);
    if (reduceMotion) {
      headStep.value = 0;
      return;
    }
    headStep.value = 0;
    headStep.value = withRepeat(
      withTiming(RUN_LOADER_PATH.length, {
        duration: RUN_LOADER_LOOP_MS,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
    return () => cancelAnimation(headStep);
  }, [headStep, reduceMotion]);

  const gap = (RUN_LOADER_SIZE - RUN_LOADER_DOT_SIZE * 5) / Math.max(1, 5 - 1);
  const unit = RUN_LOADER_DOT_SIZE + gap;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.runLoader}
    >
      {Array.from({ length: 25 }, (_, index) => (
        <RunStatusDot
          color={palette.foregroundSubtle}
          headStep={headStep}
          index={index}
          key={index}
          left={(index % 5) * unit}
          reduceMotion={reduceMotion}
          top={Math.floor(index / 5) * unit}
        />
      ))}
    </View>
  );
});

const RunStatusDot = memo(function RunStatusDot({
  color,
  headStep,
  index,
  left,
  reduceMotion,
  top,
}: {
  readonly color: string;
  readonly headStep: SharedValue<number>;
  readonly index: number;
  readonly left: number;
  readonly reduceMotion: boolean;
  readonly top: number;
}) {
  const opacity = useAnimatedStyle(() => ({
    opacity: runLoaderDotOpacity(
      index,
      Math.floor(headStep.value) % RUN_LOADER_PATH.length,
      reduceMotion,
    ),
  }));

  return (
    <Animated.View
      style={[
        styles.runLoaderDot,
        { backgroundColor: color, left, top },
        opacity,
      ]}
    />
  );
});

const styles = StyleSheet.create({
  runLoader: { height: RUN_LOADER_SIZE, width: RUN_LOADER_SIZE },
  runLoaderDot: {
    borderRadius: RUN_LOADER_DOT_SIZE / 2,
    height: RUN_LOADER_DOT_SIZE,
    position: "absolute",
    width: RUN_LOADER_DOT_SIZE,
  },
});
