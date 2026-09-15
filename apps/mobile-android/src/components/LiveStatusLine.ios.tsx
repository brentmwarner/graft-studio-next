import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useGraftPalette } from "../theme/tokens";
import { ComposingOrb } from "./ComposingOrb.ios";

/** Native iOS live phase row: G4 orb plus a single VoiceOver announcement. */
export const LiveStatusLine = memo(function LiveStatusLine({
  phrase,
  animating = true,
}: {
  readonly phrase: string;
  readonly animating?: boolean;
}) {
  const palette = useGraftPalette();
  return (
    <View
      accessible
      accessibilityLabel={phrase}
      accessibilityLiveRegion="polite"
      style={styles.row}
    >
      {animating ? <ComposingOrb size={26} /> : null}
      <Text numberOfLines={1} style={[styles.phrase, { color: palette.foregroundSubtle }]}>
        {phrase}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", gap: 8, minHeight: 26 },
  phrase: { flex: 1, fontSize: 14, lineHeight: 20, minWidth: 0 },
});
