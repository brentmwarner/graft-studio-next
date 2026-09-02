import { LinearGradient } from "expo-linear-gradient";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet } from "react-native";

import { useGraftPalette } from "../theme/tokens";

interface EdgeFadeProps {
  readonly edge: "top" | "bottom";
  readonly style?: StyleProp<ViewStyle>;
}

export function EdgeFade({ edge, style }: EdgeFadeProps) {
  const palette = useGraftPalette();
  const transparent = "rgba(0, 0, 0, 0)";
  const colors =
    edge === "top"
      ? ([
          palette.background,
          palette.background,
          palette.fadeMid,
          transparent,
        ] as const)
      : ([
          transparent,
          palette.fadeMid,
          palette.background,
          palette.background,
        ] as const);

  return (
    <LinearGradient
      colors={colors}
      locations={[0, 0.2, 0.62, 1]}
      pointerEvents="none"
      style={[styles.fade, style]}
    />
  );
}

const styles = StyleSheet.create({
  fade: {
    left: 0,
    position: "absolute",
    right: 0,
  },
});
