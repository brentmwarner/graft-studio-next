import { Host, Image } from "@expo/ui/swift-ui";
import { frame, glassEffect } from "@expo/ui/swift-ui/modifiers";
import type { ComponentProps } from "react";
import { View } from "react-native";

import { iosSystemNameForIcon } from "../chrome/liquidGlass";
import { useGraftPalette } from "../theme/tokens";

type Props = {
  readonly accessibilityLabel: string;
  readonly icon: string;
  readonly onPress: () => void;
  readonly size?: number;
};

export { iosSystemNameForIcon };

/// Native `GlassIconButton`: SF Symbol in a 44pt circle with
/// `.glassEffect(.regular.interactive(), in: .circle)`.
export function IosGlassIconButton({
  accessibilityLabel,
  icon,
  onPress,
  size = 44,
}: Props) {
  const palette = useGraftPalette();
  const systemName = iosSystemNameForIcon(icon);
  if (!systemName) return null;

  const isChevron = systemName.startsWith("chevron.");

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={{ height: size, width: size }}
    >
      <Host
        colorScheme={palette.isDark ? "dark" : "light"}
        matchContents
        style={{ height: size, width: size }}
      >
        <Image
          color={palette.foreground}
          modifiers={[
            frame({ height: size, width: size }),
            glassEffect({
              glass: { interactive: true, variant: "regular" },
              shape: "circle",
            }),
          ]}
          onPress={onPress}
          size={isChevron ? 18 : 17}
          systemName={systemName as NonNullable<ComponentProps<typeof Image>["systemName"]>}
        />
      </Host>
    </View>
  );
}
