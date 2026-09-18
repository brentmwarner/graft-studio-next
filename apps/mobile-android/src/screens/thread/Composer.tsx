import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Animated from "react-native-reanimated";

import { useDisclosureHeightTransition } from "../../components/disclosureMotion";
import { FloatingSurface } from "../../components/FloatingSurface";
import { PressScale } from "../../components/PressScale";
import { graftRadius, useGraftPalette } from "../../theme/tokens";
import { ComposerConfigMenu, type ComposerMenuConfig } from "./ComposerConfigMenu";
import { ComposerSettings } from "./ComposerSettings";
import { ComposerAttachments } from "./ComposerAttachments";
import type { ComposerAttachment } from "./composerAttachmentSend";
import { displayName } from "./displayName";
import { RecordingComposer } from "./RecordingComposer";
import type { useVoiceInput } from "./useVoiceInput";

type TrailingMode = "idle" | "send" | "stop" | "stop-and-send";

function ComposerTrailingControls({
  canSend,
  isConnected,
  isSending,
  mode,
  onCancel,
  onSend,
  onStartVoice,
}: {
  readonly canSend: boolean;
  readonly isConnected: boolean;
  readonly isSending: boolean;
  readonly mode: TrailingMode;
  readonly onCancel: () => void;
  readonly onSend: () => void;
  readonly onStartVoice: () => void;
}) {
  const palette = useGraftPalette();

  const microphone = (
    <PressScale
      accessibilityLabel="Dictate message"
      disabled={!isConnected || isSending}
      onPress={onStartVoice}
      style={styles.iconButton}
    >
      <Ionicons color={palette.foregroundMuted} name="mic-outline" size={20} />
    </PressScale>
  );

  if (mode === "idle") return microphone;

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

  if (mode === "send") {
    return (
      <View style={styles.trailingControls}>
        {microphone}
        {sendButton}
      </View>
    );
  }

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
  attachments,
  attachmentError,
  onRemoveAttachment,
  activeRunId,
  approvalIsElevated,
  canSend,
  currentApprovalLabel,
  currentModelName,
  draft,
  hostLabel,
  isConnected,
  isSending,
  onCancel,
  onDraftChange,
  menuConfig,
  modelMenuRequest,
  onSend,
  onSendDictation,
  voice,
}: {
  readonly attachments: readonly ComposerAttachment[];
  readonly attachmentError?: string;
  readonly onRemoveAttachment: (id: string) => void;
  readonly activeRunId: string | undefined;
  readonly approvalIsElevated: boolean;
  readonly canSend: boolean;
  readonly currentApprovalLabel: string;
  readonly currentModelName: string | undefined;
  readonly draft: string;
  readonly hostLabel: string;
  readonly isConnected: boolean;
  readonly isSending: boolean;
  readonly onCancel: (runId: string) => void;
  readonly onDraftChange: (text: string) => void;
  readonly menuConfig: ComposerMenuConfig;
  readonly modelMenuRequest?: number;
  readonly onSend: () => void;
  readonly onSendDictation: () => void;
  readonly voice: ReturnType<typeof useVoiceInput>;
}) {
  const palette = useGraftPalette();
  const inputRef = useRef<TextInput>(null);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const heightTransition = useDisclosureHeightTransition();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const hasDraft = Boolean(draft.trim() || attachments.length);
  const expanded = (isComposerFocused || hasDraft) && !voice.isActive;
  const editorMinHeight = 60 * fontScale;
  const editorMaxHeight = Math.max(editorMinHeight, Math.min(160 * fontScale, windowHeight * 0.3));
  const editorHeight = expanded
    ? Math.min(editorMaxHeight, Math.max(editorMinHeight, contentHeight))
    : Math.max(32, 20 * fontScale);
  // Expanded: editor padding (13 + 6) plus toolbar (32 + 7). Idle: 7 on each edge.
  const typingHeight = voice.isActive ? 0 : editorHeight + (expanded ? 58 : 14);
  const extras = menuConfig.extras;

  useEffect(() => {
    // Android's Back button can hide the keyboard without blurring TextInput.
    const subscription = Keyboard.addListener("keyboardDidHide", () => {
      inputRef.current?.blur();
      setIsComposerFocused(false);
    });
    return () => subscription.remove();
  }, []);

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
      onStartVoice={() => {
        inputRef.current?.blur();
        void voice.start(draft);
      }}
    />
  );
  const options = (
    <ComposerConfigMenu
      config={menuConfig}
      initialPage="options"
      trigger={(open) => (
        <PressScale accessibilityLabel="Composer options" onPress={open} style={styles.iconButton}>
          <Ionicons color={palette.foreground} name="add" size={24} />
        </PressScale>
      )}
    />
  );

  return (
    <View style={styles.dock}>
      {attachmentError ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.voiceError, { color: palette.danger }]}
        >
          {attachmentError}
        </Text>
      ) : null}
      {voice.error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.voiceError, { color: palette.danger }]}
        >
          {voice.error}
        </Text>
      ) : null}
      {!voice.isActive ? (
        <ComposerSettings
          config={menuConfig}
          modelName={currentModelName}
          modelMenuRequest={modelMenuRequest}
          approvalLabel={currentApprovalLabel}
          approvalIsElevated={approvalIsElevated}
        />
      ) : null}
      <View style={styles.composerRow}>
        {voice.isActive ? (
          <PressScale
            accessibilityLabel="Cancel recording"
            disabled={voice.phase === "stopping"}
            onPress={voice.cancel}
          >
            <FloatingSurface style={styles.cancelButton}>
              <Ionicons color={palette.foregroundMuted} name="close" size={20} />
            </FloatingSurface>
          </PressScale>
        ) : null}

        <View style={styles.composer}>
          <FloatingSurface style={[StyleSheet.absoluteFill, styles.composerSurface]} />
          {expanded && attachments.length > 0 ? (
            <View style={styles.attachments}>
              <ComposerAttachments
                attachments={attachments}
                disabled={isSending}
                onRemove={onRemoveAttachment}
              />
            </View>
          ) : null}
          {expanded && extras && (extras.interactionMode !== "default" || extras.fastMode) ? (
            <View style={styles.modeRow}>
              {extras.interactionMode !== "default" ? (
                <ComposerConfigMenu
                  config={menuConfig}
                  initialPage="mode"
                  trigger={(open) => (
                    <PressScale
                      accessibilityLabel="Conversation mode"
                      onPress={open}
                      style={styles.modeButton}
                    >
                      <Text style={[styles.toolbarText, { color: palette.foregroundMuted }]}>
                        {displayName(extras.interactionMode)} mode
                      </Text>
                    </PressScale>
                  )}
                />
              ) : null}
              {extras.fastMode ? (
                <ComposerConfigMenu
                  config={menuConfig}
                  initialPage="speed"
                  trigger={(open) => (
                    <PressScale
                      accessibilityLabel="Response speed"
                      onPress={open}
                      style={styles.modeButton}
                    >
                      <Text style={[styles.toolbarText, { color: palette.foregroundMuted }]}>
                        Fast
                      </Text>
                    </PressScale>
                  )}
                />
              ) : null}
            </View>
          ) : null}
          <Animated.View
            accessibilityElementsHidden={voice.isActive}
            importantForAccessibility={voice.isActive ? "no-hide-descendants" : "auto"}
            pointerEvents={voice.isActive ? "none" : "auto"}
            style={[
              styles.typingContent,
              heightTransition,
              { height: typingHeight },
              voice.isActive ? styles.typingContentHidden : null,
            ]}
          >
            <View style={[styles.typingRow, expanded ? styles.typingRowExpanded : null]}>
              <View>{!expanded && !voice.isActive ? options : null}</View>
              {/* Keep the same editor mounted through focus and recording transitions. */}
              <TextInput
                ref={inputRef}
                accessibilityLabel="Message"
                editable={isConnected && !isSending && !voice.isActive}
                maxLength={100_000}
                multiline
                onBlur={() => setIsComposerFocused(false)}
                onChangeText={onDraftChange}
                onContentSizeChange={({ nativeEvent }) => {
                  if (!voice.isActive) setContentHeight(Math.ceil(nativeEvent.contentSize.height));
                }}
                onFocus={() => setIsComposerFocused(true)}
                onSubmitEditing={onSend}
                placeholder={isConnected ? `Work on ${hostLabel}` : "Reconnecting…"}
                placeholderTextColor={palette.foregroundSubtle}
                scrollEnabled={expanded && contentHeight > editorMaxHeight}
                style={[
                  styles.composerInput,
                  {
                    color: palette.foreground,
                    height: editorHeight,
                    textAlignVertical: expanded ? "top" : "center",
                  },
                ]}
                value={draft}
              />
              <View>{!expanded && !voice.isActive ? trailing : null}</View>
            </View>
            {expanded ? (
              <View style={styles.toolbar}>
                {options}
                <View style={styles.toolbarSpacer} />
                {trailing}
              </View>
            ) : null}
          </Animated.View>
          {voice.isActive ? (
            <View style={styles.recordingRow}>
              <RecordingComposer
                phase={voice.phase}
                canSend={isConnected && !isSending}
                onStop={() => void voice.stop()}
                onSend={onSendDictation}
              />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { gap: 7 },
  composerRow: { alignItems: "flex-end", flexDirection: "row", gap: 8 },
  cancelButton: { alignItems: "center", height: 46, justifyContent: "center", width: 46 },
  composer: { flex: 1, minWidth: 0, minHeight: 46 },
  composerSurface: { borderRadius: 23 },
  attachments: { paddingHorizontal: 8, paddingTop: 10, paddingBottom: 2 },
  modeRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 7 },
  modeButton: { minHeight: 28, justifyContent: "center" },
  typingContent: { overflow: "hidden", borderRadius: 23 },
  typingContentHidden: { position: "absolute", width: "100%", opacity: 0 },
  typingRow: { alignItems: "center", flexDirection: "row", gap: 5, padding: 7 },
  typingRowExpanded: { gap: 0, paddingHorizontal: 16, paddingTop: 13, paddingBottom: 6 },
  composerInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    lineHeight: 20,
    includeFontPadding: false,
    padding: 0,
  },
  toolbar: { alignItems: "center", flexDirection: "row", paddingHorizontal: 7, paddingBottom: 7 },
  toolbarText: { fontSize: 12, fontWeight: "500" },
  toolbarSpacer: { flex: 1 },
  iconButton: { alignItems: "center", height: 32, justifyContent: "center", width: 32 },
  recordingRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 46,
    paddingLeft: 16,
    paddingRight: 5,
  },
  voiceError: { fontSize: 12, paddingHorizontal: 12 },
  trailingControls: { alignItems: "center", flexDirection: "row", gap: 5 },
  sendButton: {
    alignItems: "center",
    borderRadius: graftRadius.pill,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  secondaryStopButton: { alignItems: "center", height: 32, justifyContent: "center", width: 32 },
  stopGlyph: { borderRadius: 2, height: 12, width: 12 },
});
