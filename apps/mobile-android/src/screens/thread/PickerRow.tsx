import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useGraftPalette } from "../../theme/tokens";

export function PickerRow({
  detail,
  label,
  onPress,
  selected,
}: {
  readonly detail?: string;
  readonly label: string;
  readonly onPress: () => void;
  readonly selected: boolean;
}) {
  const palette = useGraftPalette();
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <View style={[styles.pickerRow, { borderBottomColor: palette.border }]}>
        <View style={styles.pickerCopy}>
          <Text style={[styles.pickerLabel, { color: palette.foreground }]}>
            {label}
          </Text>
          {detail ? (
            <Text
              style={[styles.pickerDetail, { color: palette.foregroundSubtle }]}
            >
              {detail}
            </Text>
          ) : null}
        </View>
        {selected ? (
          <Ionicons color={palette.accent} name="checkmark" size={20} />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pickerRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 58,
    paddingVertical: 8,
  },
  pickerCopy: { flex: 1, gap: 2 },
  pickerLabel: { fontSize: 16, fontWeight: "500" },
  pickerDetail: { fontSize: 12 },
});
