import { Ionicons } from "@expo/vector-icons";
import { StyleSheet } from "react-native";

import { canUseLiquidGlass, iosSystemNameForIcon } from "../chrome/liquidGlass";
import { useGraftPalette } from "../theme/tokens";
import { FloatingSurface } from "./FloatingSurface";
import { IosGlassIconButton } from "./IosGlassIconButton";
import { PressScale } from "./PressScale";

interface CircleIconButtonProps {
  readonly accessibilityLabel: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  /// Chevrons read smaller than a solid glyph at the same nominal size, so the
  /// back buttons ask for a couple more points.
  readonly iconSize?: number;
  readonly onPress: () => void;
}

/// A toolbar button on the same floating surface as the search pill and the
/// error banner, squared off into a circle. Every toolbar in the app sits over
/// scrolling content, so the surface is what keeps the icon legible against
/// whatever passes underneath — it is load-bearing, not decoration.
export function CircleIconButton({
  accessibilityLabel,
  icon,
  iconSize = 20,
  onPress,
}: CircleIconButtonProps) {
  const palette = useGraftPalette();

  if (canUseLiquidGlass() && iosSystemNameForIcon(icon)) {
    return (
      <IosGlassIconButton accessibilityLabel={accessibilityLabel} icon={icon} onPress={onPress} />
    );
  }

  return (
    <PressScale accessibilityLabel={accessibilityLabel} onPress={onPress}>
      <FloatingSurface style={styles.circle}>
        <Ionicons color={palette.foreground} name={icon} size={iconSize} />
      </FloatingSurface>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  // Square, so `FloatingSurface`'s pill radius resolves to a circle.
  circle: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
});
