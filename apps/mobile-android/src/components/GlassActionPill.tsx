import { Ionicons } from "@expo/vector-icons";
import { GlassView } from "expo-glass-effect";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { canUseLiquidGlass } from "../chrome/liquidGlass";
import { graftRadius } from "../theme/tokens";
import { PressScale } from "./PressScale";

interface GlassActionPillProps {
  readonly accessibilityLabel?: string;
  readonly disabled?: boolean;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly isBusy?: boolean;
  readonly onPress: () => void;
  readonly title: string;
}

/// Full-width black-glass action pill — native `GlassActionPill` anatomy:
/// icon pinned left, label centered, 56pt capsule, 0.97 press scale.
///
/// iOS uses `expo-glass-effect` `GlassView` with an explicit dark color
/// scheme — the same liquid-glass material as native Graft, not an opaque
/// black fill. Do not set `overflow: "hidden"` on this surface.
export function GlassActionPill({
  accessibilityLabel,
  disabled = false,
  icon,
  isBusy = false,
  onPress,
  title,
}: GlassActionPillProps) {
  const blocked = disabled || isBusy;
  const label = (
    <View style={styles.row}>
      <Ionicons color="#FFFFFF" name={icon} size={17} style={styles.leadingIcon} />
      {isBusy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.title}>{title}</Text>}
    </View>
  );

  return (
    <PressScale
      accessibilityLabel={accessibilityLabel ?? title}
      disabled={blocked}
      onPress={onPress}
    >
      {canUseLiquidGlass() ? (
        <GlassView
          colorScheme="dark"
          glassEffectStyle="regular"
          isInteractive
          style={styles.pill}
          tintColor="rgba(9, 9, 11, 0.82)"
        >
          {label}
        </GlassView>
      ) : (
        <View style={[styles.pill, styles.fallback]}>{label}</View>
      )}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: "#09090B",
    borderRadius: graftRadius.pill,
  },
  leadingIcon: {
    left: 22,
    position: "absolute",
  },
  pill: {
    alignItems: "center",
    borderRadius: graftRadius.pill,
    height: 56,
    justifyContent: "center",
    width: "100%",
  },
  row: {
    alignItems: "center",
    height: 56,
    justifyContent: "center",
    width: "100%",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 16.5,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
});
