import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { GraftContextUsage } from "@graft/mobile-contract";

import type { GraftPalette } from "../../theme/tokens";
import { contextProgressIconName } from "./contextUsage";

export function ContextProgressRing({
  palette,
  usage,
}: {
  readonly palette: GraftPalette;
  readonly usage: GraftContextUsage | undefined;
}) {
  return (
    <MaterialCommunityIcons
      accessible={false}
      accessibilityElementsHidden
      color={palette.foregroundMuted}
      name={contextProgressIconName(usage)}
      size={24}
    />
  );
}
