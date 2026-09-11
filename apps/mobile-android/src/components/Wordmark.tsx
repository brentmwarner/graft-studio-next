import { StyleSheet, Text, View } from "react-native";

import { graftSpacing, useGraftPalette } from "../theme/tokens";

export function Wordmark() {
  const palette = useGraftPalette();

  return (
    <View style={styles.row}>
      <View style={[styles.mark, { backgroundColor: palette.foreground }]} />
      <Text style={[styles.word, { color: palette.foreground }]}>Graft</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    borderRadius: 4,
    height: 15,
    transform: [{ rotate: "45deg" }],
    width: 15,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: graftSpacing.one + 2,
  },
  word: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
});
