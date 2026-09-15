import { Ionicons } from "@expo/vector-icons";
import { GlassView } from "expo-glass-effect";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { canUseLiquidGlass } from "../chrome/liquidGlass";
import { graftRadius } from "../theme/tokens";
import { PressScale } from "./PressScale";

export function GlassActionPill({
  disabled = false,
  icon,
  isBusy = false,
  onPress,
  title,
}: {
  readonly disabled?: boolean;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly isBusy?: boolean;
  readonly onPress: () => void;
  readonly title: string;
}) {
  const content = (
    <View style={styles.row}>
      <Ionicons color="#FFFFFF" name={icon} size={17} style={styles.leadingIcon} />
      {isBusy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.title}>{title}</Text>}
    </View>
  );
  return (
    <PressScale accessibilityLabel={title} disabled={disabled || isBusy} onPress={onPress}>
      <View style={[styles.pill, !canUseLiquidGlass() && styles.fallback]}>
        {canUseLiquidGlass() ? (
          <GlassView
            colorScheme="dark"
            glassEffectStyle="regular"
            isInteractive
            style={[StyleSheet.absoluteFill, styles.glassBackground]}
            tintColor="rgba(9, 9, 11, 0.82)"
          />
        ) : null}
        {content}
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: "#09090B", borderRadius: graftRadius.pill },
  glassBackground: { borderRadius: graftRadius.pill },
  leadingIcon: { left: 22, position: "absolute" },
  pill: {
    alignItems: "center",
    backgroundColor: "rgba(9, 9, 11, 0.88)",
    borderRadius: graftRadius.pill,
    height: 56,
    justifyContent: "center",
    width: "100%",
  },
  row: { alignItems: "center", height: 56, justifyContent: "center", width: "100%" },
  title: { color: "#FFFFFF", fontSize: 16.5, fontWeight: "600", letterSpacing: -0.3 },
});
