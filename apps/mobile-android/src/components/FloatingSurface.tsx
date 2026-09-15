import type { PropsWithChildren } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, View } from "react-native";
import { GlassView } from "expo-glass-effect";

import { canUseLiquidGlass } from "../chrome/liquidGlass";
import { graftRadius, useGraftPalette } from "../theme/tokens";

interface FloatingSurfaceProps extends PropsWithChildren {
  readonly style?: StyleProp<ViewStyle>;
  /// Native iOS uses `.regular.interactive()` on toolbar circles and search.
  readonly interactive?: boolean;
  /// Dark liquid-glass fill for primary actions (compose / welcome pill).
  readonly tintColor?: string;
  readonly glassEffectStyle?: "regular" | "clear";
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
      <GlassView
        colorScheme={palette.isDark ? "dark" : "light"}
        glassEffectStyle={glassEffectStyle}
        isInteractive={interactive}
        style={[styles.glass, style]}
        tintColor={tintColor}
      >
        {children}
      </GlassView>
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
  glass: {
    borderRadius: graftRadius.pill,
    overflow: "hidden",
  },
  surface: {
    borderRadius: graftRadius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: "0 7px 22px rgba(0, 0, 0, 0.10)",
  },
});
