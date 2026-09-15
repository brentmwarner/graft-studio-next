import type { GraftContextUsage } from "@graft/mobile-contract";

import type { GraftPalette } from "../../theme/tokens";
import { ProgressRing } from "../../components/ProgressRing";

export function ContextProgressRing({
  palette,
  usage,
}: {
  readonly palette: GraftPalette;
  readonly usage: GraftContextUsage | undefined;
}) {
  return (
    <ProgressRing
      palette={palette}
      percent={usage?.source === "measured" ? usage.percent : undefined}
    />
  );
}
