import { CircularProgressIndicator, Host } from "@expo/ui/jetpack-compose";
import { size as composeSize } from "@expo/ui/jetpack-compose/modifiers";
import { View } from "react-native";

import type { GraftPalette } from "../theme/tokens";

/** Thin, round-ended context ring for the header button. */
export function ProgressRing({
  palette,
  percent,
  size = 20,
}: {
  readonly palette: GraftPalette;
  readonly percent: number | undefined;
  readonly size?: number;
}) {
  const progress = percent === undefined ? 0 : Math.max(0, Math.min(100, percent)) / 100;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      <Host style={{ width: size, height: size }} ignoreSafeAreaKeyboardInsets>
        <CircularProgressIndicator
          progress={progress}
          color={palette.foregroundMuted}
          trackColor={percent === undefined ? palette.foregroundSubtle : palette.muted}
          strokeWidth={size > 24 ? 3 : 2}
          strokeCap="round"
          gapSize={0}
          modifiers={[composeSize(size, size)]}
        />
      </Host>
    </View>
  );
}
