import { Ionicons } from "@expo/vector-icons";
import type { GraftModelOption } from "@graft/mobile-contract";
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { iosGlassCornerRadius } from "../../chrome/liquidGlass";

import { FloatingSurface } from "../../components/FloatingSurface";
import { PressScale } from "../../components/PressScale";
import { graftRadius, useGraftPalette } from "../../theme/tokens";
import { ComposerAttachMenu } from "./ComposerAttachMenu";
import { ComposerConfigMenu, type ComposerMenuConfig } from "./ComposerConfigMenu";
import { COMPOSER_ATTACHMENTS_SUPPORTED, type ComposerAttachment } from "./composerAttachments";
import { displayName } from "./displayName";
import { useComposerAttachments } from "./useComposerAttachments";

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
  const attach = useComposerAttachments();
  const hasDraft = Boolean(draft.trim());
  const hasAttachments = COMPOSER_ATTACHMENTS_SUPPORTED && attach.attachments.length > 0;

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

  if (Platform.OS === "ios") {
    return (
      <IosComposer
        approvalIsElevated={approvalIsElevated}
        canChangeApproval={canChangeApproval}
        currentApprovalLabel={currentApprovalLabel}
        currentModel={currentModel}
        currentModelName={currentModelName}
        attach={attach}
        draft={draft}
        hasApprovalOptions={hasApprovalOptions}
        hasAttachments={hasAttachments}
        hasDraft={hasDraft}
        isComposerFocused={isComposerFocused}
        isConnected={isConnected}
        menuConfig={menuConfig}
        onDraftChange={onDraftChange}
        onFocusChange={setIsComposerFocused}
        onSend={onSend}
        resolvedEffort={resolvedEffort}
        trailing={trailing}
      />
    );
  }

  return (
    <View style={styles.dock}>
      <View style={styles.chipRow}>
        {currentModel || availableModels.length > 0 ? (
          <ComposerConfigMenu
            config={menuConfig}
            initialPage="intelligence"
            trigger={(open) => (
              <PressScale accessibilityLabel="Model and reasoning effort" onPress={open}>
                <FloatingSurface interactive style={styles.chip}>
                  <Text numberOfLines={1} style={[styles.modelName, { color: palette.foreground }]}>
                    {currentModel?.label ?? currentModelName?.replace("[1m]", "") ?? "Model"}
                    {resolvedEffort ? ` ${displayName(resolvedEffort)}` : ""}
                  </Text>
                </FloatingSurface>
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
                  <FloatingSurface interactive style={styles.chip}>
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
                  </FloatingSurface>
                </PressScale>
              )}
            />
          ) : (
            <FloatingSurface interactive={false} style={styles.chip}>
              <Text numberOfLines={1} style={[styles.chipText, { color: palette.foreground }]}>
                {currentApprovalLabel}
              </Text>
            </FloatingSurface>
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

const IOS_COMPOSER_HEIGHT = 46;

function AttachmentStrip({
  attachments,
  onRemove,
}: {
  readonly attachments: readonly ComposerAttachment[];
  readonly onRemove: (id: string) => void;
}) {
  return (
    <View style={iosStyles.strip}>
      {attachments.map((attachment) => (
        <View key={attachment.id} style={iosStyles.thumbWrap}>
          <Image source={{ uri: attachment.uri }} style={iosStyles.thumb} />
          <Pressable
            accessibilityLabel={`Remove ${attachment.name}`}
            hitSlop={8}
            onPress={() => onRemove(attachment.id)}
            style={iosStyles.thumbRemove}
          >
            <Ionicons color="#FFFFFF" name="close" size={11} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function IosComposer({
  approvalIsElevated,
  attach,
  canChangeApproval,
  currentApprovalLabel,
  currentModel,
  currentModelName,
  draft,
  hasApprovalOptions,
  hasAttachments,
  hasDraft,
  isComposerFocused,
  isConnected,
  menuConfig,
  onDraftChange,
  onFocusChange,
  onSend,
  resolvedEffort,
  trailing,
}: {
  readonly approvalIsElevated: boolean;
  readonly attach: ReturnType<typeof useComposerAttachments>;
  readonly canChangeApproval: boolean;
  readonly currentApprovalLabel: string;
  readonly currentModel: GraftModelOption | undefined;
  readonly currentModelName: string | undefined;
  readonly draft: string;
  readonly hasApprovalOptions: boolean;
  readonly hasAttachments: boolean;
  readonly hasDraft: boolean;
  readonly isComposerFocused: boolean;
  readonly isConnected: boolean;
  readonly menuConfig: ComposerMenuConfig;
  readonly onDraftChange: (text: string) => void;
  readonly onFocusChange: (focused: boolean) => void;
  readonly onSend: () => void;
  readonly resolvedEffort: string | undefined;
  readonly trailing: ReactNode;
}) {
  const palette = useGraftPalette();
  const expanded = isComposerFocused || hasDraft || hasAttachments;
  const radius = iosGlassCornerRadius(IOS_COMPOSER_HEIGHT);

  const permissions = hasApprovalOptions ? (
    canChangeApproval ? (
      <ComposerConfigMenu
        config={menuConfig}
        initialPage="permissions"
        trigger={(open) => (
          <PressScale accessibilityLabel="Permissions" onPress={open}>
            <View style={iosStyles.inlineChip}>
              <Text
                numberOfLines={1}
                style={[
                  iosStyles.chipText,
                  { color: approvalIsElevated ? palette.warning : palette.foregroundSubtle },
                ]}
              >
                {currentApprovalLabel}
              </Text>
            </View>
          </PressScale>
        )}
      />
    ) : (
      <View style={iosStyles.inlineChip}>
        <Text numberOfLines={1} style={[iosStyles.chipText, { color: palette.foregroundSubtle }]}>
          {currentApprovalLabel}
        </Text>
      </View>
    )
  ) : null;

  const modelTrigger =
    currentModel || menuConfig.models.length > 0 ? (
      <ComposerConfigMenu
        config={menuConfig}
        initialPage="intelligence"
        trigger={(open) => (
          <PressScale accessibilityLabel="Model and reasoning effort" onPress={open}>
            <View style={iosStyles.inlineChip}>
              <Text numberOfLines={1} style={[iosStyles.modelName, { color: palette.foreground }]}>
                {currentModel?.label ?? currentModelName?.replace("[1m]", "") ?? "Model"}
              </Text>
              {resolvedEffort ? (
                <Text style={[iosStyles.effort, { color: palette.foregroundSubtle }]}>
                  {displayName(resolvedEffort)}
                </Text>
              ) : null}
            </View>
          </PressScale>
        )}
      />
    ) : null;

  return (
    <View style={iosStyles.dock}>
      <FloatingSurface
        interactive={false}
        style={[
          iosStyles.capsule,
          {
            borderRadius: radius,
            minHeight: expanded ? 118 : IOS_COMPOSER_HEIGHT,
          },
        ]}
      >
        {COMPOSER_ATTACHMENTS_SUPPORTED && attach.error ? (
          <Text style={[iosStyles.attachError, { color: palette.danger }]}>{attach.error}</Text>
        ) : null}
        {COMPOSER_ATTACHMENTS_SUPPORTED && hasAttachments ? (
          <AttachmentStrip attachments={attach.attachments} onRemove={attach.remove} />
        ) : null}
        <TextInput
          accessibilityLabel="Message"
          editable={isConnected}
          maxLength={100_000}
          multiline
          onBlur={() => onFocusChange(false)}
          onChangeText={onDraftChange}
          onFocus={() => onFocusChange(true)}
          onSubmitEditing={onSend}
          placeholder={isConnected ? "Message Graft" : "Reconnecting…"}
          placeholderTextColor={palette.foregroundSubtle}
          style={[iosStyles.input, { color: palette.foreground }]}
          value={draft}
        />
        {expanded ? (
          <View style={iosStyles.controls}>
            {COMPOSER_ATTACHMENTS_SUPPORTED ? <ComposerAttachMenu attach={attach} compact /> : null}
            {permissions}
            <View style={iosStyles.grow} />
            {modelTrigger}
            {trailing}
          </View>
        ) : (
          <View style={iosStyles.collapsedTrailing}>{trailing}</View>
        )}
      </FloatingSurface>
    </View>
  );
}

const iosStyles = StyleSheet.create({
  attachError: {
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  capsule: {
    overflow: "hidden",
    paddingBottom: 7,
    paddingTop: 2,
  },
  chipText: { fontSize: 13, fontWeight: "500" },
  collapsedTrailing: {
    bottom: 5,
    position: "absolute",
    right: 7,
  },
  controls: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    minHeight: 32,
    paddingHorizontal: 7,
  },
  dock: { paddingHorizontal: 12 },
  effort: { fontSize: 13, fontWeight: "500" },
  grow: { flex: 1 },
  inlineChip: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    height: 32,
    maxWidth: 180,
    paddingHorizontal: 8,
  },
  input: {
    fontSize: 17,
    lineHeight: 22,
    maxHeight: 120,
    minHeight: 20,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  modelName: { fontSize: 13, fontWeight: "500" },
  plus: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  strip: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  thumb: {
    borderRadius: 8,
    height: 44,
    width: 44,
  },
  thumbRemove: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 8,
    height: 16,
    justifyContent: "center",
    position: "absolute",
    right: -4,
    top: -4,
    width: 16,
  },
  thumbWrap: {
    height: 44,
    width: 44,
  },
});

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
