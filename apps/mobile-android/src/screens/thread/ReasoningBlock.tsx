import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { LiveStatusLine } from "../../components/LiveStatusLine";
import { THINKING_PHRASE } from "../../state/toolPresentation";
import { useGraftPalette } from "../../theme/tokens";

export function ReasoningBlock({
  reasoning,
  streaming,
}: {
  readonly reasoning: string;
  readonly streaming: boolean;
}) {
  const palette = useGraftPalette();
  const [expanded, setExpanded] = useState(false);
  if (!reasoning.trim()) return null;
  const latestLine = reasoning.split("\n").filter(Boolean).at(-1) ?? reasoning;

  return (
    <View style={styles.reasoningBlock}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setExpanded((value) => !value)}
      >
        <View style={styles.reasoningHeader}>
          {streaming ? (
            <View style={styles.liveCopy}>
              <LiveStatusLine phrase={THINKING_PHRASE} />
            </View>
          ) : (
            <Text
              style={[styles.reasoningTitle, { color: palette.foregroundSubtle }]}
            >
              Thoughts
            </Text>
          )}
          <Ionicons
            color={palette.foregroundSubtle}
            name="chevron-forward"
            size={13}
            style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}
          />
        </View>
      </Pressable>
      {expanded ? (
        <View
          style={[
            styles.reasoningExpanded,
            { borderLeftColor: palette.border },
          ]}
        >
          <Text
            selectable
            style={[styles.reasoningText, { color: palette.foregroundSubtle }]}
          >
            {reasoning}
          </Text>
        </View>
      ) : streaming ? (
        <Text
          numberOfLines={2}
          style={[styles.reasoningText, { color: palette.foregroundSubtle }]}
        >
          {latestLine}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  reasoningBlock: { gap: 6, marginBottom: 8 },
  reasoningHeader: { alignItems: "center", flexDirection: "row", gap: 5 },
  liveCopy: { flex: 1, minWidth: 0 },
  reasoningTitle: { fontSize: 14, fontWeight: "500" },
  reasoningExpanded: { borderLeftWidth: 2, paddingLeft: 10 },
  reasoningText: { fontSize: 13, lineHeight: 18 },
});
