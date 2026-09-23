import { ProgressiveBlurView } from "expo-backdrop";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, View } from "react-native";

import { useGraftPalette } from "../theme/tokens";

interface EdgeFadeProps {
  readonly edge: "top" | "bottom";
  readonly style?: StyleProp<ViewStyle>;
}

/// Scroll-edge progressive blur from `expo-backdrop`. The native view finds
/// the scroll surface behind it, ramps blur toward `edge`, and fades in only
/// once content sits under that edge. Fast flicks swap to a page-colored
/// gradient so the blur capture does not trail the list.
export function EdgeFade({ edge, style }: EdgeFadeProps) {
  const palette = useGraftPalette();

  return (
    <View pointerEvents="none" style={style}>
      <ProgressiveBlurView
        edge={edge}
        fallbackColor={palette.background}
        intensity={64}
        startOffset={0.18}
        style={StyleSheet.absoluteFill}
        tint={palette.isDark ? "systemUltraThinMaterialDark" : "systemUltraThinMaterialLight"}
        tintColor={palette.fadeMid}
      />
    </View>
  );
}
