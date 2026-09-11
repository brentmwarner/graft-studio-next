import { Ionicons } from "@expo/vector-icons";
import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, FadeInDown } from "react-native-reanimated";

import { LiveStatusLine } from "../../components/LiveStatusLine";
import type { TranscriptItem } from "../../state/mobileViewModels";
import { toolRunningPhrase } from "../../state/toolPresentation";
import { useGraftPalette } from "../../theme/tokens";

/// Enter transition for rows that appear *while the user is watching* — a new
/// tool run, the assistant's reply arriving. Fade plus a short rise, ease-out,
/// under 300ms: entering elements want their motion front-loaded so the row
/// registers the instant it lands. Deliberately NOT applied to settled rows —
/// virtualization remounts those on scroll-back, and animating that would make
/// simply scrolling the transcript flicker.
export const ROW_ENTER = FadeInDown.duration(220).easing(Easing.out(Easing.cubic));

/// A folded run of tool calls. While one is running the header is the
/// live status line — orb plus the current action. Settled, it collapses
/// to the run's size and taps open the individual calls.
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
    <Animated.View entering={running ? ROW_ENTER : undefined}>
      <Pressable
        accessibilityLabel={phrase}
        accessibilityRole="button"
        onPress={() => setExpanded((value) => !value)}
      >
        <View style={styles.toolRow}>
          {running ? (
            <View style={styles.liveCopy}>
              <LiveStatusLine phrase={phrase} />
            </View>
          ) : (
            <>
              <Ionicons
                color={palette.foregroundSubtle}
                name="checkmark-circle-outline"
                size={17}
              />
              <View style={styles.toolCopy}>
                <Text style={[styles.toolTitle, { color: palette.foregroundMuted }]}>{phrase}</Text>
              </View>
            </>
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
        <View style={styles.toolGroupBody}>
          {item.tools.map((tool) => (
            <ToolRow item={tool} key={tool.id} />
          ))}
        </View>
      ) : null}
    </Animated.View>
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
      onPress={() => setExpanded((value) => !value)}
    >
      <View style={styles.toolRow}>
        {item.running ? (
          <View style={styles.liveCopy}>
            <LiveStatusLine phrase={phrase} />
          </View>
        ) : (
          <>
            <Ionicons color={palette.foregroundSubtle} name="checkmark-circle-outline" size={17} />
            <View style={styles.toolCopy}>
              <Text style={[styles.toolTitle, { color: palette.foregroundMuted }]}>
                {item.name}
              </Text>
            </View>
          </>
        )}
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
  liveCopy: { flex: 1, minWidth: 0 },
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
