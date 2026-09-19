import { Host, Text } from "@expo/ui/jetpack-compose";
import { memo } from "react";
import { StyleSheet, View } from "react-native";

import { useGraftPalette } from "../theme/tokens";
import { RunStatusDotMatrix } from "./RunStatusDotMatrix";

// Only the transcript footer owns live status. Phrase changes leave the
// original dot animation mounted and update a single native text element.
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
      {animating ? <RunStatusDotMatrix /> : null}
      <Host ignoreSafeAreaKeyboardInsets matchContents={{ vertical: true }} style={styles.phrase}>
        <Text
          color={palette.foregroundSubtle}
          maxLines={1}
          overflow="ellipsis"
          style={{ fontSize: 14, lineHeight: 20 }}
        >
          {phrase}
        </Text>
      </Host>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 24 },
  phrase: { flex: 1, minWidth: 0 },
});
