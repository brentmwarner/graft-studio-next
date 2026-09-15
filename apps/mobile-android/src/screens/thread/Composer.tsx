import { Ionicons } from "@expo/vector-icons";
import type { GraftModelOption } from "@graft/mobile-contract";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";

import { FloatingSurface } from "../../components/FloatingSurface";
import { PressScale } from "../../components/PressScale";
import { graftRadius, useGraftPalette } from "../../theme/tokens";
import { ComposerConfigMenu, type ComposerMenuConfig } from "./ComposerConfigMenu";
import { displayName } from "./displayName";

type TrailingMode = "idle" | "send" | "stop" | "stop-and-send";

function ComposerTrailingControls({
  canSend,
  isConnected,
  isSending,
  mode,
  onCancel,
  onSend,
}: {
  readonly canSend: boolean;
  readonly isConnected: boolean;
  readonly isSending: boolean;
  readonly mode: TrailingMode;
  readonly onCancel: () => void;
  readonly onSend: () => void;
}) {
  const palette = useGraftPalette();

  if (mode === "idle") {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[styles.micHint, { opacity: isConnected ? 1 : 0.35 }]}
      >
        <Ionicons color={palette.foregroundMuted} name="mic-outline" size={23} />
      </View>
    );
  }

  const sendButton = (
    <PressScale accessibilityLabel="Send message" disabled={!canSend} onPress={onSend}>
      <View
        style={[
          styles.sendButton,
          {
            backgroundColor: palette.foreground,
            opacity: canSend || mode === "stop-and-send" ? 1 : 0.35,
          },
        ]}
      >
        {isSending ? (
          <ActivityIndicator color={palette.background} size="small" />
        ) : (
          <Ionicons color={palette.background} name="arrow-up" size={20} />
        )}
      </View>
    </PressScale>
  );

  if (mode === "send") return sendButton;

  const stopButton = (
    <PressScale accessibilityLabel="Stop response" onPress={onCancel}>
      <View style={[styles.sendButton, { backgroundColor: palette.foreground }]}>
        <View style={[styles.stopGlyph, { backgroundColor: palette.background }]} />
      </View>
    </PressScale>
  );

  if (mode === "stop") return stopButton;

  return (
    <View style={styles.trailingControls}>
      <PressScale accessibilityLabel="Stop response" onPress={onCancel}>
        <View style={styles.secondaryStopButton}>
          <View style={[styles.stopGlyph, { backgroundColor: palette.foregroundMuted }]} />
        </View>
      </PressScale>
      {sendButton}
    </View>
  );
}

export function Composer({
  activeRunId,
  approvalIsElevated,
  availableModels,
  canSend,
  currentApprovalLabel,
  currentModel,
  currentModelName,
  draft,
  canChangeApproval,
  hasApprovalOptions,
  hostLabel,
  isConnected,
  isSending,
  onCancel,
  onDraftChange,
  menuConfig,
  onSend,
  resolvedEffort,
}: {
  readonly activeRunId: string | undefined;
  readonly approvalIsElevated: boolean;
  readonly availableModels: readonly GraftModelOption[];
  readonly canSend: boolean;
  readonly currentApprovalLabel: string;
  readonly currentModel: GraftModelOption | undefined;
  readonly currentModelName: string | undefined;
  readonly draft: string;
  readonly canChangeApproval: boolean;
  readonly hasApprovalOptions: boolean;
  readonly hostLabel: string;
  readonly isConnected: boolean;
  readonly isSending: boolean;
  readonly onCancel: (runId: string) => void;
  readonly onDraftChange: (text: string) => void;
  readonly menuConfig: ComposerMenuConfig;
  readonly onSend: () => void;
  readonly resolvedEffort: string | undefined;
}) {
  const palette = useGraftPalette();
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const hasDraft = Boolean(draft.trim());

  let trailingMode: TrailingMode = "idle";
  if (activeRunId) {
    trailingMode = hasDraft ? "stop-and-send" : "stop";
  } else if (hasDraft) {
    trailingMode = "send";
  }

  const trailing = (
    <ComposerTrailingControls
      canSend={canSend}
      isConnected={isConnected}
      isSending={isSending}
      mode={trailingMode}
      onCancel={() => {
        if (activeRunId) onCancel(activeRunId);
      }}
      onSend={onSend}
    />
  );

  return (
    <View style={styles.dock}>
      <View style={styles.chipRow}>
        {currentModel || availableModels.length > 0 ? (
          <ComposerConfigMenu
            config={menuConfig}
            initialPage="intelligence"
            trigger={(open) => (
              <PressScale accessibilityLabel="Model and reasoning effort" onPress={open}>
                <View style={[styles.chip, { backgroundColor: palette.subtle }]}>
                  <Text numberOfLines={1} style={[styles.modelName, { color: palette.foreground }]}>
                    {currentModel?.label ?? currentModelName?.replace("[1m]", "") ?? "Model"}
                    {resolvedEffort ? ` ${displayName(resolvedEffort)}` : ""}
                  </Text>
                </View>
              </PressScale>
            )}
          />
        ) : null}
        {hasApprovalOptions ? (
          canChangeApproval ? (
            <ComposerConfigMenu
              config={menuConfig}
              initialPage="permissions"
              trigger={(open) => (
                <PressScale accessibilityLabel="Permissions" onPress={open}>
                  <View style={[styles.chip, { backgroundColor: palette.subtle }]}>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.chipText,
                        {
                          color: approvalIsElevated ? palette.warning : palette.foreground,
                        },
                      ]}
                    >
                      {currentApprovalLabel}
                    </Text>
                  </View>
                </PressScale>
              )}
            />
          ) : (
            <View style={[styles.chip, { backgroundColor: palette.subtle }]}>
              <Text numberOfLines={1} style={[styles.chipText, { color: palette.foreground }]}>
                {currentApprovalLabel}
              </Text>
            </View>
          )
        ) : null}
      </View>

      <View style={styles.composerRow}>
        <ComposerConfigMenu
          config={menuConfig}
          initialPage="options"
          trigger={(open) => (
            <PressScale accessibilityLabel="Composer options" onPress={open}>
              <FloatingSurface style={styles.addButton}>
                <Ionicons color={palette.foreground} name="add" size={28} />
              </FloatingSurface>
            </PressScale>
          )}
        />

        <FloatingSurface
          style={[
            styles.composer,
            isComposerFocused || hasDraft ? styles.composerFocused : null,
            { borderRadius: graftRadius.composer },
          ]}
        >
          <TextInput
            accessibilityLabel="Message"
            editable={isConnected}
            maxLength={100_000}
            multiline
            onBlur={() => setIsComposerFocused(false)}
            onChangeText={onDraftChange}
            onFocus={() => setIsComposerFocused(true)}
            onSubmitEditing={onSend}
            placeholder={isConnected ? `Work on ${hostLabel}` : "Reconnecting…"}
            placeholderTextColor={palette.foregroundSubtle}
            style={[styles.composerInput, { color: palette.foreground }]}
            value={draft}
          />
          {trailing}
        </FloatingSurface>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { gap: 7 },
  chipRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    paddingLeft: 2,
  },
  chip: {
    borderRadius: graftRadius.pill,
    justifyContent: "center",
    maxWidth: 236,
    minHeight: 32,
    paddingHorizontal: 12,
  },
  chipText: { fontSize: 12, fontWeight: "600" },
  modelName: { fontSize: 12, fontWeight: "600" },
  composerRow: { alignItems: "flex-end", flexDirection: "row", gap: 8 },
  addButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  composer: {
    alignItems: "flex-end",
    flex: 1,
    flexDirection: "row",
    minHeight: 44,
    padding: 4,
    paddingLeft: 10,
  },
  composerFocused: { minHeight: 44 },
  composerInput: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    maxHeight: 122,
    minHeight: 36,
    paddingHorizontal: 2,
    paddingVertical: 8,
  },
  micHint: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  trailingControls: { alignItems: "center", flexDirection: "row", gap: 2 },
  sendButton: {
    alignItems: "center",
    borderRadius: graftRadius.pill,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  secondaryStopButton: {
    alignItems: "center",
    height: 38,
    justifyContent: "center",
    width: 32,
  },
  stopGlyph: { borderRadius: 2, height: 12, width: 12 },
});
