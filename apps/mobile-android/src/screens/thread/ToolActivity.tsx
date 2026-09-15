import { Ionicons } from "@expo/vector-icons";
import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { TranscriptItem } from "../../state/mobileViewModels";
import { toolRunningPhrase } from "../../state/toolPresentation";
import { useGraftPalette } from "../../theme/tokens";

// Tool details are quiet; the thread owns the single live indicator.
export const ToolActivityStrip = memo(function ToolActivityStrip({
  item,
}: {
  readonly item: Extract<TranscriptItem, { kind: "toolGroup" }>;
}) {
  const palette = useGraftPalette();
  const [expanded, setExpanded] = useState(false);
  const running = [...item.tools].reverse().find((tool) => tool.running);
  const phrase = running
    ? toolRunningPhrase(running.name, running.detail)
    : `${item.tools.length} tool calls`;

  return (
    <View>
      <Pressable
        accessibilityLabel={phrase}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
      >
        <View style={styles.toolRow}>
          <View style={styles.toolCopy}>
            <Text style={[styles.toolTitle, { color: palette.foregroundMuted }]}>
              {item.tools.length} tool calls
            </Text>
          </View>
          <Ionicons
            color={palette.foregroundSubtle}
            name="chevron-forward"
            size={13}
            style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}
          />
        </View>
      </Pressable>
      {expanded ? (
        <View style={styles.toolGroupBody}>
          {item.tools.map((tool) => (
            <ToolRow item={tool} key={tool.id} />
          ))}
        </View>
      ) : null}
    </View>
  );
});

export const ToolRow = memo(function ToolRow({
  item,
}: {
  readonly item: Extract<TranscriptItem, { kind: "tool" }>;
}) {
  const palette = useGraftPalette();
  const [expanded, setExpanded] = useState(false);
  const phrase = toolRunningPhrase(item.name, item.detail);
  return (
    <Pressable
      accessibilityLabel={item.running ? phrase : item.name}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={() => setExpanded((value) => !value)}
    >
      <View style={styles.toolRow}>
        <Ionicons
          color={palette.foregroundSubtle}
          name={item.running ? "terminal-outline" : "checkmark-circle-outline"}
          size={17}
        />
        <View style={styles.toolCopy}>
          <Text style={[styles.toolTitle, { color: palette.foregroundMuted }]}>{item.name}</Text>
        </View>
        {item.detail ? (
          <Ionicons
            color={palette.foregroundSubtle}
            name="chevron-forward"
            size={13}
            style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}
          />
        ) : null}
      </View>
      {expanded && item.detail ? (
        <Text selectable style={[styles.toolDetail, { color: palette.foregroundSubtle }]}>
          {item.detail}
        </Text>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  toolRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingVertical: 4,
  },
  toolCopy: { flex: 1 },
  toolGroupBody: { gap: 2, paddingLeft: 25, paddingTop: 2 },
  toolTitle: { fontSize: 14, fontWeight: "500", lineHeight: 19 },
  toolDetail: {
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
    paddingLeft: 25,
  },
});
