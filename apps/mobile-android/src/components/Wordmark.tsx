import { StyleSheet, Text, View } from "react-native";

import { graftSpacing, useGraftPalette } from "../theme/tokens";
import { GraftMark } from "./GraftMark";

export function Wordmark({ markSize = 20 }: { readonly markSize?: number }) {
  const palette = useGraftPalette();

  return (
    <View style={styles.row}>
      <GraftMark size={markSize} />
      <Text style={[styles.word, { color: palette.foreground }]}>Graft</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
