import type { PropsWithChildren } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, View } from "react-native";
import { GlassView } from "expo-glass-effect";

import { canUseLiquidGlass } from "../chrome/liquidGlass";
import { graftRadius, useGraftPalette } from "../theme/tokens";

interface FloatingSurfaceProps extends PropsWithChildren {
  readonly glassEffectStyle?: "regular" | "clear";
  readonly interactive?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly tintColor?: string;
}

export function FloatingSurface({
  children,
  glassEffectStyle = "regular",
  interactive = true,
  style,
  tintColor,
}: FloatingSurfaceProps) {
  const palette = useGraftPalette();

  if (canUseLiquidGlass()) {
    return (
      <View style={[styles.glass, style]}>
        <GlassView
          colorScheme={palette.isDark ? "dark" : "light"}
          glassEffectStyle={glassEffectStyle}
          isInteractive={interactive}
          style={[StyleSheet.absoluteFill, styles.glassBackground]}
          tintColor={tintColor}
        />
        {children}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.surface,
        {
          backgroundColor: palette.floatingSurface,
          borderColor: palette.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  glass: { borderRadius: graftRadius.pill },
  glassBackground: { borderRadius: graftRadius.pill },
  surface: {
    borderRadius: graftRadius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: "0 7px 22px rgba(0, 0, 0, 0.10)",
  },
});
