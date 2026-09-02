import { LinearGradient } from "expo-linear-gradient";
import { memo, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
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

const WIPE_MS = 320;
const CROSSFADE_MS = 220;
const FEATHER = 28;
const WIPE_EASE = Easing.bezier(0.25, 0.1, 0.25, 1);
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

/// Phrase stays in place and is uncovered from the leading edge with a
/// feathered mask so letters fade on instead of getting sliced. Reduce
/// Motion keeps a short opacity crossfade and skips the wipe.
const PhraseWipe = memo(function PhraseWipe({
  phrase,
  color,
  fadeMid,
  background,
}: {
  readonly phrase: string;
  readonly color: string;
  readonly fadeMid: string;
  readonly background: string;
}) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const outgoingOpacity = useSharedValue(0);
  const incomingOpacity = useSharedValue(1);
  const previousPhrase = useRef(phrase);
  const [textWidth, setTextWidth] = useState(0);
  const [outgoing, setOutgoing] = useState("");

  useEffect(() => {
    const previous = previousPhrase.current;
    previousPhrase.current = phrase;
    if (!previous || previous === phrase) {
      outgoingOpacity.value = 0;
      incomingOpacity.value = 1;
      setOutgoing("");
      if (reduceMotion) progress.value = 1;
      return;
    }
    if (reduceMotion) {
      setOutgoing(previous);
      outgoingOpacity.value = 1;
      outgoingOpacity.value = withTiming(0, {
        duration: CROSSFADE_MS,
        easing: Easing.out(Easing.quad),
      });
      progress.value = 1;
      incomingOpacity.value = 0;
      incomingOpacity.value = withTiming(1, {
        duration: CROSSFADE_MS,
        easing: Easing.out(Easing.quad),
      });
      return;
    }
    setOutgoing("");
    outgoingOpacity.value = 0;
    incomingOpacity.value = 1;
    progress.value = 0;
  }, [incomingOpacity, outgoingOpacity, phrase, progress, reduceMotion]);

  const clipStyle = useAnimatedStyle(() => ({
    overflow: "hidden" as const,
    width: textWidth > 0 ? textWidth * progress.value + FEATHER : 0,
  }));
  const outgoingStyle = useAnimatedStyle(() => ({
    opacity: outgoingOpacity.value,
  }));
  const incomingStyle = useAnimatedStyle(() => ({
    opacity: incomingOpacity.value,
  }));

  return (
    <View collapsable={false} style={styles.phraseClip}>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        key={phrase}
        numberOfLines={1}
        onLayout={(event) => {
          setTextWidth(Math.ceil(event.nativeEvent.layout.width));
          if (reduceMotion) {
            progress.value = 1;
            return;
          }
          progress.value = 0;
          progress.value = withTiming(1, {
            duration: WIPE_MS,
            easing: WIPE_EASE,
          });
        }}
        pointerEvents="none"
        style={[styles.phrase, styles.measure]}
      >
        {phrase}
      </Text>
      {outgoing ? (
        <Animated.Text
          numberOfLines={1}
          style={[styles.phrase, styles.outgoing, { color }, outgoingStyle]}
        >
          {outgoing}
        </Animated.Text>
      ) : null}
      <Animated.View style={[clipStyle, incomingStyle]}>
        <Text
          numberOfLines={1}
          style={[styles.phrase, { color, width: textWidth || undefined }]}
        >
          {phrase}
        </Text>
        {reduceMotion ? null : (
          <LinearGradient
            colors={["rgba(0, 0, 0, 0)", fadeMid, background]}
            end={{ x: 1, y: 0.5 }}
            locations={[0, 0.42, 1]}
            pointerEvents="none"
            start={{ x: 0, y: 0.5 }}
            style={styles.feather}
          />
        )}
      </Animated.View>
    </View>
  );
});

/// Dot-matrix loader + live status phrase. The loader stays put; the next phrase sits in
/// place and is wiped on from the leading edge. No elapsed timer.
export const LiveStatusLine = memo(function LiveStatusLine({
  phrase,
}: {
  readonly phrase: string;
}) {
  const palette = useGraftPalette();

  return (
    <View
      accessibilityLabel={phrase}
      accessibilityLiveRegion="polite"
      style={styles.row}
    >
      <RunStatusDotMatrix />
      <PhraseWipe
        background={palette.background}
        color={palette.foreground}
        fadeMid={palette.fadeMid}
        phrase={phrase}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: RUN_LOADER_SIZE,
  },
  phraseClip: { flex: 1, minWidth: 0, overflow: "hidden" },
  phrase: { fontSize: 15, fontWeight: "500", lineHeight: 20 },
  measure: { left: 0, opacity: 0, position: "absolute", top: 0 },
  outgoing: { left: 0, position: "absolute", top: 0 },
  feather: {
    bottom: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: FEATHER,
  },
  runLoader: { height: RUN_LOADER_SIZE, width: RUN_LOADER_SIZE },
  runLoaderDot: {
    borderRadius: RUN_LOADER_DOT_SIZE / 2,
    height: RUN_LOADER_DOT_SIZE,
    position: "absolute",
    width: RUN_LOADER_DOT_SIZE,
  },
});
