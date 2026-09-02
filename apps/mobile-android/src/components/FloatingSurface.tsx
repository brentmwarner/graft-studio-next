import type { PropsWithChildren } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, View } from "react-native";

import { graftRadius, useGraftPalette } from "../theme/tokens";

interface FloatingSurfaceProps extends PropsWithChildren {
  readonly style?: StyleProp<ViewStyle>;
}

export function FloatingSurface({ children, style }: FloatingSurfaceProps) {
  const palette = useGraftPalette();

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
  surface: {
    borderRadius: graftRadius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: "0 7px 22px rgba(0, 0, 0, 0.10)",
  },
});
