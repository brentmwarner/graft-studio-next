import { Ionicons } from "@expo/vector-icons";
import type { GraftTimelineEvent } from "@graft/mobile-contract";
import { memo, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ActivityCard } from "../../components/ActivityCard";
import {
  buildTranscriptItems,
  reconcileTranscriptItems,
  type TranscriptItem,
} from "../../state/mobileViewModels";
import { graftRadius, useGraftPalette } from "../../theme/tokens";
import { ReasoningBlock } from "./ReasoningBlock";
import { ToolActivityStrip, ToolRow } from "./ToolActivity";
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
export function renderTranscriptRow({ item }: { readonly item: TranscriptItem }) {
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
          <View style={[styles.userBubble, { backgroundColor: palette.bubble }]}>
            {item.attachments?.map((attachment) => (
              <View key={attachment.id} style={styles.attachment}>
                <Ionicons
                  name={attachment.type === "image" ? "image-outline" : "document-outline"}
                  size={18}
                  color={palette.foregroundMuted}
                />
                <Text
                  numberOfLines={2}
                  style={[styles.attachmentName, { color: palette.foreground }]}
                >
                  {attachment.name}
                </Text>
              </View>
            ))}
            {item.text ? (
              <Text selectable style={[styles.userText, { color: palette.foreground }]}>
                {item.text}
              </Text>
            ) : null}
          </View>
        </View>
      );
    case "assistant":
      return (
        <View style={styles.assistantRow}>
          <ReasoningBlock reasoning={item.reasoning} />
          {item.text ? (
            <StreamingMarkdownMessage content={item.text} streaming={item.streaming} />
          ) : null}
        </View>
      );
    case "tool":
      return (
        <View>
          <ToolRow item={item} />
        </View>
      );
    case "toolGroup":
      return <ToolActivityStrip item={item} />;
    case "activity":
      return <ActivityCard item={item} />;
    case "error":
      return (
        <Text selectable style={[styles.centeredNote, { color: palette.danger }]}>
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
  attachment: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  attachmentName: { flexShrink: 1, fontSize: 13, lineHeight: 18 },
  userText: { fontSize: 16, lineHeight: 22 },
  assistantRow: { alignItems: "flex-start", width: "100%" },
  centeredNote: {
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 20,
    textAlign: "center",
  },
});
