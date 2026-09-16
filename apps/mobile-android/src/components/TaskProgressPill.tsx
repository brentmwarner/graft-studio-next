import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition, ReduceMotion } from "react-native-reanimated";
import type { TaskProgress } from "../state/taskProgress";
import { useGraftPalette } from "../theme/tokens";

const disclosure = LinearTransition.duration(280).reduceMotion(ReduceMotion.System);

export function TaskProgressPill({ progress }: { readonly progress: TaskProgress }) {
  const palette = useGraftPalette();
  const [expanded, setExpanded] = useState(false);

  return (
    <Animated.View
      layout={disclosure}
      style={[
        styles.surface,
        { backgroundColor: palette.subtle, alignSelf: expanded ? "stretch" : "flex-start" },
      ]}
    >
      {expanded ? (
        <Animated.View
          entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)}
          exiting={FadeOut.duration(100).reduceMotion(ReduceMotion.System)}
        >
          <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
            {progress.items.map((item) => (
              <View
                key={item.id}
                accessible
                accessibilityLabel={`${item.title}, ${item.status === "done" ? "Completed" : item.status === "active" ? "In progress" : "Pending"}`}
                style={styles.row}
              >
                <Ionicons
                  name={
                    item.status === "done"
                      ? "checkmark-circle"
                      : item.status === "active"
                        ? "radio-button-on"
                        : "ellipse-outline"
                  }
                  color={item.status === "active" ? palette.foreground : palette.foregroundSubtle}
                  size={19}
                  style={styles.status}
                />
                <Text
                  style={[
                    styles.task,
                    {
                      color: item.status === "done" ? palette.foregroundSubtle : palette.foreground,
                      textDecorationLine: item.status === "done" ? "line-through" : "none",
                    },
                  ]}
                >
                  {item.title}
                </Text>
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${progress.title}, ${progress.completedCount} of ${progress.items.length} completed`}
        accessibilityState={{ expanded }}
        accessibilityHint={expanded ? "Hide task details" : "Show task details"}
        onPress={() => setExpanded((value) => !value)}
        style={styles.header}
      >
        <Ionicons
          name={progress.isComplete ? "checkmark-circle" : "list-outline"}
          size={18}
          color={palette.foregroundMuted}
        />
        <Text numberOfLines={1} style={[styles.title, { color: palette.foregroundMuted }]}>
          {progress.title}
        </Text>
        <Text style={[styles.count, { color: palette.foregroundSubtle }]}>
          {progress.completedCount}/{progress.items.length}
        </Text>
        {expanded ? <View style={styles.spacer} /> : null}
        <Ionicons
          name={expanded ? "chevron-down" : "chevron-up"}
          size={13}
          color={palette.foregroundSubtle}
        />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  surface: { borderRadius: 22, maxWidth: "100%", overflow: "hidden" },
  header: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: { fontSize: 15, fontWeight: "500", flexShrink: 1 },
  count: { fontSize: 15, fontVariant: ["tabular-nums"] },
  spacer: { flex: 1 },
  scroll: { maxHeight: 240 },
  list: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 16 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  status: { marginTop: 1 },
  task: { flex: 1, fontSize: 15, lineHeight: 21 },
});
