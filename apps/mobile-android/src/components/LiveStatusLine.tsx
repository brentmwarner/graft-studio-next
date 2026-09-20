import { memo } from "react";
import { StyleSheet, View } from "react-native";

import { RunStatusDotMatrix } from "./RunStatusDotMatrix";
import { ShimmerText } from "./ShimmerText";

// Only the transcript footer owns live status. Phrase changes leave the
// original dot animation mounted while the label shimmers on the UI thread.
export const LiveStatusLine = memo(function LiveStatusLine({
  phrase,
  animating = true,
}: {
  readonly phrase: string;
  readonly animating?: boolean;
}) {
  return (
    <View
      accessible
      accessibilityLabel={phrase}
      accessibilityLiveRegion="polite"
      style={styles.row}
    >
      {animating ? <RunStatusDotMatrix /> : null}
      <View style={styles.phrase}>
        <ShimmerText text={phrase} animating={animating} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 24 },
  phrase: { flex: 1, minWidth: 0 },
});
