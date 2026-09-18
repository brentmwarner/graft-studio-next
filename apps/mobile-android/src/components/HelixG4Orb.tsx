import { memo, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { useGraftPalette } from "../theme/tokens";
import {
  HELIX_G4_CYCLE,
  HELIX_G4_DOT_DIAMETER,
  HELIX_G4_STAGE,
  helixG4Dots,
  type HelixG4Dot,
} from "./helixG4";

const LIVE_STATUS_ORB_SIZE = 26;
const FRAME_MS = 1000 / 30;

/** AICSS G4 helix/globe used as Graft's thinking / composing indicator. */
export const HelixG4Orb = memo(function HelixG4Orb({
  size = LIVE_STATUS_ORB_SIZE,
}: {
  readonly size?: number;
}) {
  const palette = useGraftPalette();
  const reduceMotion = useReducedMotion();
  const [dots, setDots] = useState<readonly HelixG4Dot[]>(() => helixG4Dots(0));

  useEffect(() => {
    if (reduceMotion || typeof requestAnimationFrame !== "function") {
      setDots(helixG4Dots(0));
      return;
    }
    let frame = 0;
    let last = 0;
    const started = performance.now();
    const loop = (now: number) => {
      if (now - last >= FRAME_MS) {
        last = now;
        const progress = ((now - started) / 1000 / HELIX_G4_CYCLE) % 1;
        setDots(helixG4Dots(progress));
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [reduceMotion]);

  const scale = size / HELIX_G4_STAGE;
  const radius = Math.max(0.35, (HELIX_G4_DOT_DIAMETER * scale) / 2);
  const center = size / 2;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: size, width: size }}
    >
      {dots.map((dot, index) => (
        <View
          key={index}
          style={[
            styles.dot,
            {
              backgroundColor: palette.foreground,
              height: radius * 2,
              left: center + dot.x * scale - radius,
              opacity: dot.opacity,
              top: center + dot.y * scale - radius,
              width: radius * 2,
            },
          ]}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  dot: {
    borderRadius: 999,
    position: "absolute",
  },
});
