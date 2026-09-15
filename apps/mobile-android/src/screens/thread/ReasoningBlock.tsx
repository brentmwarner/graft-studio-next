import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useGraftPalette } from "../../theme/tokens";

export function ReasoningBlock({ reasoning }: { readonly reasoning: string }) {
  const palette = useGraftPalette();
  const [expanded, setExpanded] = useState(false);
  if (!reasoning.trim()) return null;

  return (
    <View style={styles.reasoningBlock}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Thoughts"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
      >
        <View style={styles.reasoningHeader}>
          <Text style={[styles.reasoningTitle, { color: palette.foregroundSubtle }]}>Thoughts</Text>
          <Ionicons
            color={palette.foregroundSubtle}
            name="chevron-forward"
            size={13}
            style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}
          />
        </View>
      </Pressable>
      {expanded ? (
        <View style={[styles.reasoningExpanded, { borderLeftColor: palette.border }]}>
          <Text selectable style={[styles.reasoningText, { color: palette.foregroundSubtle }]}>
            {reasoning}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  reasoningBlock: { gap: 6, marginBottom: 8 },
  reasoningHeader: { alignItems: "center", flexDirection: "row", gap: 5 },
  reasoningTitle: { fontSize: 14, fontWeight: "500" },
  reasoningExpanded: { borderLeftWidth: 2, paddingLeft: 10 },
  reasoningText: { fontSize: 13, lineHeight: 18 },
});
