import { Ionicons } from "@expo/vector-icons";
import type { GraftModelOption } from "@graft/mobile-contract";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PressScale } from "../../components/PressScale";
import { graftRadius, useGraftPalette } from "../../theme/tokens";
import { displayName } from "./displayName";

const EFFORT_ORDER = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "ultracode",
] as const;

function orderEfforts(efforts: readonly string[]): string[] {
  const rank = new Map(EFFORT_ORDER.map((effort, index) => [effort, index]));
  return [...efforts].sort(
    (left, right) =>
      (rank.get(left as (typeof EFFORT_ORDER)[number]) ?? 999) -
      (rank.get(right as (typeof EFFORT_ORDER)[number]) ?? 999),
  );
}

export function ComposerConfigMenu({
  currentModel,
  efforts,
  onClose,
  onOpenModel,
  onSelectEffort,
  onSpeedPress,
  resolvedEffort,
  visible,
}: {
  readonly currentModel: GraftModelOption | undefined;
  readonly efforts: readonly string[];
  readonly onClose: () => void;
  readonly onOpenModel: () => void;
  readonly onSelectEffort: (effort: string) => void;
  readonly onSpeedPress: () => void;
  readonly resolvedEffort: string | undefined;
  readonly visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const palette = useGraftPalette();

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityLabel="Close intelligence menu"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.menu,
            {
              backgroundColor: palette.floatingSurface,
              borderColor: palette.border,
              bottom: insets.bottom + 110,
            },
          ]}
        >
          <Text style={[styles.label, { color: palette.foregroundSubtle }]}>
            Intelligence
          </Text>
          {orderEfforts(efforts).map((effort) => (
            <PressScale
              accessibilityLabel={`${displayName(effort)} intelligence`}
              key={effort}
              onPress={() => onSelectEffort(effort)}
            >
              <View style={styles.optionRow}>
                <Text
                  style={[styles.optionText, { color: palette.foreground }]}
                >
                  {displayName(effort)}
                </Text>
                {effort === resolvedEffort ? (
                  <Ionicons
                    color={palette.foreground}
                    name="checkmark"
                    size={22}
                  />
                ) : null}
              </View>
            </PressScale>
          ))}

          <View
            style={[styles.separator, { backgroundColor: palette.border }]}
          />

          <PressScale accessibilityLabel="Choose model" onPress={onOpenModel}>
            <View style={styles.detailRow}>
              <View style={styles.detailCopy}>
                <Text
                  style={[styles.detailTitle, { color: palette.foreground }]}
                >
                  Model
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.detailValue,
                    { color: palette.foregroundSubtle },
                  ]}
                >
                  {currentModel?.label ?? "Model"}
                </Text>
              </View>
              <Ionicons
                color={palette.foreground}
                name="chevron-forward"
                size={20}
              />
            </View>
          </PressScale>

          <PressScale accessibilityLabel="Speed" onPress={onSpeedPress}>
            <View style={styles.detailRow}>
              <View style={styles.detailCopy}>
                <Text
                  style={[styles.detailTitle, { color: palette.foreground }]}
                >
                  Speed
                </Text>
                <Text
                  style={[
                    styles.detailValue,
                    { color: palette.foregroundSubtle },
                  ]}
                >
                  Normal
                </Text>
              </View>
              <Ionicons
                color={palette.foreground}
                name="chevron-forward"
                size={20}
              />
            </View>
          </PressScale>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  menu: {
    borderRadius: graftRadius.large,
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: "0 14px 34px rgba(0, 0, 0, 0.16)",
    left: 16,
    maxHeight: "74%",
    paddingHorizontal: 20,
    paddingVertical: 14,
    position: "absolute",
    width: 190,
  },
  label: { fontSize: 14, marginBottom: 6 },
  optionRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 42,
  },
  optionText: { fontSize: 16, fontWeight: "600" },
  separator: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  detailRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 60,
  },
  detailCopy: { flex: 1, gap: 3 },
  detailTitle: { fontSize: 16, fontWeight: "600" },
  detailValue: { fontSize: 14 },
});
