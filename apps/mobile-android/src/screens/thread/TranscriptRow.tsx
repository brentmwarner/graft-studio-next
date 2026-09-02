import type { GraftTimelineEvent } from "@graft/mobile-contract";
import { memo, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { ActivityCard } from "../../components/ActivityCard";
import {
  buildTranscriptItems,
  reconcileTranscriptItems,
  type TranscriptItem,
} from "../../state/mobileViewModels";
import { graftRadius, useGraftPalette } from "../../theme/tokens";
import { ReasoningBlock } from "./ReasoningBlock";
import { ROW_ENTER, ToolActivityStrip, ToolRow } from "./ToolActivity";
import { StreamingMarkdownMessage } from "./StreamingMarkdownMessage";

const NO_ITEMS: readonly TranscriptItem[] = [];

/// Rebuild the transcript, then reconcile it against the previous rows so
/// unchanged rows keep their object identity and the memoized row components
/// below can bail out. Mirrors how the iOS `ChatModel` mutates surviving rows
/// in place instead of replacing the whole array on every fold.
export function useReconciledTranscript(
  settledEvents: readonly GraftTimelineEvent[],
  liveEvents: readonly GraftTimelineEvent[],
  snapshotCursor: number,
): readonly TranscriptItem[] {
  const previousRef = useRef<readonly TranscriptItem[]>(NO_ITEMS);
  return useMemo(() => {
    const reconciled = reconcileTranscriptItems(
      previousRef.current,
      buildTranscriptItems(settledEvents, liveEvents, snapshotCursor),
    );
    // Idempotent: reconciling an already-reconciled array returns it unchanged,
    // so a double render never churns identities.
    previousRef.current = reconciled;
    return reconciled;
  }, [settledEvents, liveEvents, snapshotCursor]);
}

/// Hoisted so `FlatList` sees the same function identity every render — an
/// inline `renderItem` re-renders every mounted cell regardless of `React.memo`.
export function renderTranscriptRow({
  item,
}: {
  readonly item: TranscriptItem;
}) {
  return <TranscriptRow item={item} />;
}

export function transcriptRowKey(item: TranscriptItem): string {
  return item.id;
}

export const TranscriptRow = memo(function TranscriptRow({
  item,
}: {
  readonly item: TranscriptItem;
}) {
  const palette = useGraftPalette();
  switch (item.kind) {
    case "user":
      return (
        <View style={styles.userRow}>
          <View
            style={[styles.userBubble, { backgroundColor: palette.bubble }]}
          >
            <Text
              selectable
              style={[styles.userText, { color: palette.foreground }]}
            >
              {item.text}
            </Text>
          </View>
        </View>
      );
    case "assistant":
      return (
        <Animated.View
          entering={item.streaming ? ROW_ENTER : undefined}
          style={styles.assistantRow}
        >
          <ReasoningBlock
            reasoning={item.reasoning}
            streaming={item.streaming && !item.text}
          />
          {item.text ? (
            <StreamingMarkdownMessage
              content={item.text}
              streaming={item.streaming}
            />
          ) : null}
        </Animated.View>
      );
    case "tool":
      return (
        <Animated.View entering={item.running ? ROW_ENTER : undefined}>
          <ToolRow item={item} />
        </Animated.View>
      );
    case "toolGroup":
      return <ToolActivityStrip item={item} />;
    case "activity":
      return <ActivityCard item={item} />;
    case "error":
      return (
        <Text
          selectable
          style={[styles.centeredNote, { color: palette.danger }]}
        >
          {item.text}
        </Text>
      );
    default:
      return item satisfies never;
  }
});

const styles = StyleSheet.create({
  userRow: { alignItems: "flex-end", paddingLeft: 56 },
  userBubble: {
    borderRadius: graftRadius.bubble,
    maxWidth: "100%",
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  userText: { fontSize: 16, lineHeight: 22 },
  assistantRow: { alignItems: "flex-start", width: "100%" },
  centeredNote: {
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 20,
    textAlign: "center",
  },
});
