import type { PropsWithChildren } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import { GlassContainer } from "expo-glass-effect";

import { canUseLiquidGlass } from "../chrome/liquidGlass";

interface GlassStackProps extends PropsWithChildren {
  readonly spacing?: number;
  readonly style?: StyleProp<ViewStyle>;
}

/// Native `GlassEffectContainer` — adjacent glass views merge at `spacing`.
export function GlassStack({ children, spacing = 10, style }: GlassStackProps) {
  if (canUseLiquidGlass()) {
    return (
      <GlassContainer spacing={spacing} style={style}>
        {children}
      </GlassContainer>
    );
  }

  return <View style={style}>{children}</View>;
}
