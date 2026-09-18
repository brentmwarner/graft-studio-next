import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { TranscriptItem } from "../../state/mobileViewModels";
import { useGraftPalette } from "../../theme/tokens";
import { ToolRow } from "./ToolActivity";
import { turnWorkSummary } from "./turnWorkSummary";

export function ReasoningBlock({
  reasoning,
  foldedActivity = [],
}: {
  readonly reasoning: string;
  readonly foldedActivity?: readonly TranscriptItem[];
}) {
  const palette = useGraftPalette();
  const [expanded, setExpanded] = useState(false);
  const hasFold = foldedActivity.length > 0;
  if (!hasFold && !reasoning.trim()) return null;
  const header = hasFold ? turnWorkSummary(foldedActivity) : "Thoughts";

  return (
    <View style={styles.reasoningBlock}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={header}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
      >
        <View style={styles.reasoningHeader}>
          <Text style={[styles.reasoningTitle, { color: palette.foregroundSubtle }]}>{header}</Text>
          <Ionicons
            color={palette.foregroundSubtle}
            name="chevron-forward"
            size={13}
            style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}
          />
        </View>
      </Pressable>
      {expanded ? (
        hasFold ? (
          <View style={styles.foldedBody}>
            {foldedActivity.map((item) => (
              <FoldedTurnWork item={item} key={item.id} />
            ))}
            {reasoning.trim() ? (
              <View style={[styles.reasoningExpanded, { borderLeftColor: palette.border }]}>
                <Text
                  selectable
                  style={[styles.reasoningText, { color: palette.foregroundSubtle }]}
                >
                  {reasoning}
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={[styles.reasoningExpanded, { borderLeftColor: palette.border }]}>
            <Text selectable style={[styles.reasoningText, { color: palette.foregroundSubtle }]}>
              {reasoning}
            </Text>
          </View>
        )
      ) : null}
    </View>
  );
}

function FoldedTurnWork({ item }: { readonly item: TranscriptItem }) {
  const palette = useGraftPalette();
  if (item.kind === "tool") return <ToolRow item={item} />;
  if (item.kind === "assistant" && item.text.trim()) {
    return (
      <Text selectable style={[styles.foldedCommentary, { color: palette.foregroundSubtle }]}>
        {item.text}
      </Text>
    );
  }
  if (item.kind === "assistant" && item.reasoning.trim()) {
    return (
      <Text selectable style={[styles.foldedCommentary, { color: palette.foregroundSubtle }]}>
        {item.reasoning}
      </Text>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  reasoningBlock: { gap: 6, marginBottom: 8 },
  reasoningHeader: { alignItems: "center", flexDirection: "row", gap: 5 },
  reasoningTitle: { fontSize: 14, fontWeight: "500" },
  reasoningExpanded: { borderLeftWidth: 2, paddingLeft: 10 },
  reasoningText: { fontSize: 13, lineHeight: 18 },
  foldedBody: { gap: 12, paddingLeft: 6 },
  foldedCommentary: { fontSize: 14, lineHeight: 20 },
});
