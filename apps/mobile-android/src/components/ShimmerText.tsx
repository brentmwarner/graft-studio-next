import { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";

import { useGraftPalette } from "../theme/tokens";

/** A left-to-right highlight; only native text colors animate, never layout or React state. */
export const ShimmerText = memo(function ShimmerText({
  text,
  animating = true,
}: {
  readonly text: string;
  readonly animating?: boolean;
}) {
  const palette = useGraftPalette();
  const reducedMotion = useReducedMotion();
  const highlight = useMemo(
    () => ({
      "0%, 60%, 100%": { color: palette.foregroundSubtle },
      "30%": { color: palette.foreground },
    }),
    [palette.foreground, palette.foregroundSubtle],
  );
  if (!animating || reducedMotion) {
    return (
      <Text numberOfLines={1} style={[styles.text, { color: palette.foregroundSubtle }]}>
        {text}
      </Text>
    );
  }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.row}
    >
      {Array.from(text).map((character, index) => (
        <Animated.Text
          key={index}
          style={[
            styles.text,
            {
              color: palette.foregroundSubtle,
              animationName: highlight,
              animationDuration: 1_800,
              animationDelay: index * 45 - 1_800,
              animationIterationCount: "infinite",
              animationTimingFunction: "linear",
            },
          ]}
        >
          {character}
        </Animated.Text>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", overflow: "hidden", flexShrink: 1 },
  text: { fontSize: 14, lineHeight: 20, fontWeight: "500" },
});
