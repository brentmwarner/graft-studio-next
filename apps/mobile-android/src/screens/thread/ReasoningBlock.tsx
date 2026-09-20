import { Ionicons } from "@expo/vector-icons";
import { DISCLOSURE_CLEANUP_BUFFER_MS } from "@graft/shared/disclosureMotion";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { useDisclosureHeightTransition } from "../../components/disclosureMotion";
import { MarkdownMessage } from "../../components/MarkdownMessage";
import type { TranscriptItem } from "../../state/mobileViewModels";
import { useGraftPalette } from "../../theme/tokens";
import { ToolRow } from "./ToolActivity";

export function ReasoningBlock({
  reasoning,
  foldedActivity = [],
}: {
  readonly reasoning: string;
  readonly foldedActivity?: readonly TranscriptItem[];
}) {
  const hasFold = foldedActivity.length > 0;
  if (!hasFold && !reasoning.trim()) return null;
  const header = hasFold ? "Worked" : "Thoughts";

  return (
    <ReasoningDisclosure
      key={header}
      header={header}
      reasoning={reasoning}
      foldedActivity={foldedActivity}
    />
  );
}

function ReasoningDisclosure({
  header,
  reasoning,
  foldedActivity,
}: {
  readonly header: string;
  readonly reasoning: string;
  readonly foldedActivity: readonly TranscriptItem[];
}) {
  const palette = useGraftPalette();
  const [expanded, setExpanded] = useState(false);
  const [retained, setRetained] = useState(false);
  const [bodyHeight, setBodyHeight] = useState(0);
  const heightTransition = useDisclosureHeightTransition();
  const duration = heightTransition.transitionDuration;
  const hasFold = foldedActivity.length > 0;

  useEffect(() => {
    if (expanded) {
      setRetained(true);
      return;
    }
    if (!retained) return;
    if (duration === 0) {
      setRetained(false);
      return;
    }
    const timeout = setTimeout(() => setRetained(false), duration + DISCLOSURE_CLEANUP_BUFFER_MS);
    return () => clearTimeout(timeout);
  }, [duration, expanded, retained]);

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
          <Animated.View
            style={{
              ...heightTransition,
              transitionProperty: "transform",
              transform: [{ rotate: expanded ? "90deg" : "0deg" }],
            }}
          >
            <Ionicons color={palette.foregroundSubtle} name="chevron-forward" size={13} />
          </Animated.View>
        </View>
      </Pressable>
      <Animated.View
        accessibilityElementsHidden={!expanded}
        importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
        pointerEvents={expanded ? "auto" : "none"}
        style={[styles.disclosureBody, heightTransition, { height: expanded ? bodyHeight : 0 }]}
      >
        {expanded || retained ? (
          <View
            onLayout={(event) => setBodyHeight(event.nativeEvent.layout.height)}
            style={styles.measuredBody}
          >
            {hasFold ? (
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
                <Text
                  selectable
                  style={[styles.reasoningText, { color: palette.foregroundSubtle }]}
                >
                  {reasoning}
                </Text>
              </View>
            )}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

function FoldedTurnWork({ item }: { readonly item: TranscriptItem }) {
  const palette = useGraftPalette();
  if (item.kind === "tool") return <ToolRow item={item} />;
  if (item.kind === "assistant") {
    return (
      <View style={styles.foldedAssistant}>
        {item.reasoning.trim() ? (
          <Text selectable style={[styles.foldedCommentary, { color: palette.foregroundSubtle }]}>
            {item.reasoning}
          </Text>
        ) : null}
        {item.text.trim() ? <MarkdownMessage>{item.text}</MarkdownMessage> : null}
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  reasoningBlock: { alignSelf: "stretch", marginBottom: 8 },
  reasoningHeader: { alignItems: "center", flexDirection: "row", gap: 5 },
  reasoningTitle: { fontSize: 14, fontWeight: "500" },
  reasoningExpanded: { borderLeftWidth: 2, paddingLeft: 10 },
  reasoningText: { fontSize: 13, lineHeight: 18 },
  disclosureBody: { overflow: "hidden" },
  measuredBody: { position: "absolute", top: 0, left: 0, right: 0, paddingTop: 6 },
  foldedBody: { gap: 12, paddingLeft: 6 },
  foldedAssistant: { gap: 6 },
  foldedCommentary: { fontSize: 14, lineHeight: 20 },
});
