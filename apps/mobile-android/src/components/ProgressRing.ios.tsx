import Svg, { Circle } from "react-native-svg";

import type { GraftPalette } from "../theme/tokens";

/** SwiftUI-style thin context ring for the iOS navigation bar. */
export function ProgressRing({
  palette,
  percent,
  size = 20,
}: {
  readonly palette: GraftPalette;
  readonly percent: number | undefined;
  readonly size?: number;
}) {
  const strokeWidth = size > 24 ? 3 : 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = percent === undefined ? 0 : Math.max(0, Math.min(100, percent)) / 100;
  return (
    <Svg
      accessibilityElementsHidden
      height={size}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      width={size}
    >
      <Circle
        cx={size / 2}
        cy={size / 2}
        fill="none"
        r={radius}
        stroke={percent === undefined ? palette.foregroundSubtle : palette.muted}
        strokeWidth={strokeWidth}
      />
      {percent === undefined ? null : (
        <Circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          origin={`${size / 2}, ${size / 2}`}
          r={radius}
          rotation={-90}
          stroke={palette.foregroundMuted}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - progress)}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
        />
      )}
    </Svg>
  );
}
