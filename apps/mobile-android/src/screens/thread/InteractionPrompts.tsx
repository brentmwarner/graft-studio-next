import { Ionicons } from "@expo/vector-icons";
import type {
  GraftApprovalDecision,
  GraftApprovalRequest,
  GraftQuestionRequest,
} from "@graft/mobile-contract";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { PressScale } from "../../components/PressScale";
import { graftRadius, useGraftPalette } from "../../theme/tokens";

export function ApprovalPrompt({
  approval,
  onResolve,
}: {
  readonly approval: GraftApprovalRequest;
  readonly onResolve: (decision: GraftApprovalDecision) => void;
}) {
  const palette = useGraftPalette();
  return (
    <View style={[styles.interactionCard, { backgroundColor: palette.elevated }]}>
      <View style={styles.interactionHeading}>
        <Ionicons color={palette.foreground} name="shield-half-outline" size={18} />
        <Text style={[styles.interactionTitle, { color: palette.foreground }]}>
          Approval needed
        </Text>
      </View>
      <Text style={[styles.interactionDetail, { color: palette.foregroundMuted }]}>
        {approval.title}
      </Text>
      {approval.detail ? (
        <Text
          numberOfLines={3}
          style={[styles.interactionCaption, { color: palette.foregroundSubtle }]}
        >
          {approval.detail}
        </Text>
      ) : null}
      <View style={styles.promptButtons}>
        <Pressable
          onPress={() => onResolve("deny")}
          style={[styles.promptButton, { backgroundColor: palette.subtle }]}
        >
          <Text style={{ color: palette.danger }}>Deny</Text>
        </Pressable>
        <Pressable
          onPress={() => onResolve("allow_once")}
          style={[styles.promptButton, { backgroundColor: palette.subtle }]}
        >
          <Text style={{ color: palette.foreground }}>Once</Text>
        </Pressable>
        <Pressable
          onPress={() => onResolve("allow_session")}
          style={[styles.promptButton, { backgroundColor: palette.foreground }]}
        >
          <Text style={{ color: palette.background }}>Session</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function QuestionPrompt({
  onResolve,
  question,
}: {
  readonly onResolve: (answer: { readonly optionId?: string; readonly text?: string }) => void;
  readonly question: GraftQuestionRequest;
}) {
  const palette = useGraftPalette();
  const [answer, setAnswer] = useState("");
  return (
    <View style={[styles.interactionCard, { backgroundColor: palette.elevated }]}>
      <Text style={[styles.interactionTitle, { color: palette.foreground }]}>
        {question.prompt}
      </Text>
      {question.options?.map((option) => (
        <Pressable
          key={option.id}
          onPress={() => onResolve({ optionId: option.id })}
          style={[styles.optionButton, { backgroundColor: palette.subtle }]}
        >
          <Text style={[styles.optionText, { color: palette.foreground }]}>{option.label}</Text>
        </Pressable>
      ))}
      {question.allowFreeform !== false ? (
        <View style={styles.customAnswerRow}>
          <TextInput
            onChangeText={setAnswer}
            placeholder="Custom answer"
            placeholderTextColor={palette.foregroundSubtle}
            style={[
              styles.customAnswer,
              { backgroundColor: palette.subtle, color: palette.foreground },
            ]}
            value={answer}
          />
          <PressScale
            accessibilityLabel="Send answer"
            disabled={!answer.trim()}
            onPress={() => {
              const text = answer.trim();
              if (text) onResolve({ text });
            }}
          >
            <View style={[styles.answerButton, { backgroundColor: palette.foreground }]}>
              <Ionicons color={palette.background} name="arrow-up" size={17} />
            </View>
          </PressScale>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  interactionCard: { borderRadius: 16, gap: 8, padding: 12 },
  interactionHeading: { alignItems: "center", flexDirection: "row", gap: 7 },
  interactionTitle: { fontSize: 14, fontWeight: "600", lineHeight: 19 },
  interactionDetail: { fontFamily: "monospace", fontSize: 12, lineHeight: 17 },
  interactionCaption: { fontSize: 12, lineHeight: 17 },
  promptButtons: { flexDirection: "row", gap: 7, justifyContent: "flex-end" },
  promptButton: {
    alignItems: "center",
    borderRadius: graftRadius.pill,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: 13,
  },
  optionButton: {
    borderRadius: graftRadius.small,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  optionText: { fontSize: 14 },
  customAnswerRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  customAnswer: {
    borderRadius: graftRadius.small,
    flex: 1,
    fontSize: 14,
    height: 40,
    paddingHorizontal: 11,
  },
  answerButton: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
});
