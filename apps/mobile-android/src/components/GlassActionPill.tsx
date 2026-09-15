import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { canUseLiquidGlass } from "../chrome/liquidGlass";
import { graftRadius } from "../theme/tokens";
import { FloatingSurface } from "./FloatingSurface";
import { PressScale } from "./PressScale";

interface GlassActionPillProps {
  readonly accessibilityLabel?: string;
  readonly disabled?: boolean;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly isBusy?: boolean;
  readonly onPress: () => void;
  readonly title: string;
}

/// Full-width black-glass action pill — the native `GlassActionPill`:
/// icon pinned left, label centered, 56pt capsule, 0.97 press scale.
export function GlassActionPill({
  accessibilityLabel,
  disabled = false,
  icon,
  isBusy = false,
  onPress,
  title,
}: GlassActionPillProps) {
  const ink = "#FFFFFF";
  const blocked = disabled || isBusy;

  const label = (
    <View style={styles.row}>
      <Ionicons color={ink} name={icon} size={17} style={styles.leadingIcon} />
      {isBusy ? (
        <ActivityIndicator color={ink} />
      ) : (
        <Text style={styles.title}>{title}</Text>
      )}
    </View>
  );

  return (
    <PressScale
      accessibilityLabel={accessibilityLabel ?? title}
      disabled={blocked}
      onPress={onPress}
    >
      {canUseLiquidGlass() ? (
        <FloatingSurface interactive style={styles.pill} tintColor="#09090B">
          {label}
        </FloatingSurface>
      ) : (
        <View style={[styles.pill, styles.fallback, { backgroundColor: "#09090B" }]}>
          {label}
        </View>
      )}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  fallback: {
    borderRadius: graftRadius.pill,
  },
  leadingIcon: {
    left: 22,
    position: "absolute",
  },
  pill: {
    alignItems: "center",
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
