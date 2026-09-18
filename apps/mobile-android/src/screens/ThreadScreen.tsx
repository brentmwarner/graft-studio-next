import { Ionicons } from "@expo/vector-icons";
import type {
  GraftApprovalDecision,
  GraftComposerCommand,
  GraftDiffSummary,
  GraftInteractionMode,
  GraftEnvironmentSnapshot,
  GraftModelOption,
  GraftQuestionRequest,
  GraftThreadSummary,
  GraftThreadUsage,
  GraftTimelineEvent,
} from "@graft/mobile-contract";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  Vibration,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { GatewayConnectionState } from "../api/gatewaySocket";
import { AnchoredMenu, MenuItem } from "../components/AnchoredMenu";
import { UsageMenu } from "./thread/UsageMenu";
import { CircleIconButton } from "../components/CircleIconButton";
import { EdgeFade } from "../components/EdgeFade";
import { FloatingSurface } from "../components/FloatingSurface";
import { LiveStatusLine } from "../components/LiveStatusLine";
import { PressScale } from "../components/PressScale";
import { transcriptLiveStatus } from "../state/liveStatus";
import type { ModelCatalogStatus } from "../state/useModelCatalog";
import { TaskProgressPill } from "../components/TaskProgressPill";
import { useGraftPalette } from "../theme/tokens";
import { attachmentHostError, type ComposerSendOptions } from "./thread/composerAttachmentSend";
import { useComposerAttachments } from "./thread/useComposerAttachments";
import { Composer } from "./thread/Composer";
import { composerBottomPadding } from "./thread/composerBottomSpacing";
import { ContextProgressRing } from "./thread/ContextProgressRing";
import { contextUsageAccessibilityLabel } from "./thread/contextUsage";
import { DiffSheet } from "./thread/DiffSheet";
import { SlashPalette } from "./thread/SlashPalette";
import { ApprovalPrompt, QuestionPrompt } from "./thread/InteractionPrompts";
import { renderTranscriptRow, transcriptRowKey } from "./thread/TranscriptRow";
import { useThreadModel } from "./thread/useThreadModel";
import { useVoiceInput } from "./thread/useVoiceInput";
import { useKeyboardVisibility } from "./thread/useKeyboardVisibility";
import { useTranscriptFollow } from "./thread/useTranscriptFollow";

const THREAD_HEADER_HEIGHT = 44;

interface ThreadScreenProps {
  readonly availableModels: readonly GraftModelOption[];
  readonly connectionState: GatewayConnectionState;
  readonly diffSummary?: GraftDiffSummary;
  readonly onLoadDiffFile: (
    threadId: string,
    path: string,
  ) => Promise<GraftDiffSummary | undefined>;
  readonly error?: string;
  readonly isRefreshing: boolean;
  readonly hostLabel: string;
  readonly initialEffort?: string;
  readonly liveEvents: readonly GraftTimelineEvent[];
  readonly onBack: () => void;
  readonly onCancel: (runId: string) => Promise<boolean>;
  readonly onLoadDiff: (threadId: string, diffId?: string) => Promise<void>;
  readonly onLoadUsage: (threadId: string) => Promise<GraftThreadUsage>;
  readonly onLoadComposerCommands: (threadId: string) => Promise<readonly GraftComposerCommand[]>;
  readonly onLoadModels: (force?: boolean) => Promise<void>;
  readonly modelCatalog: ModelCatalogStatus;
  readonly onRefresh: () => Promise<void>;
  readonly onResolveApproval: (
    approvalId: string,
    decision: GraftApprovalDecision,
  ) => Promise<boolean>;
  readonly onResolveQuestion: (
    question: Pick<GraftQuestionRequest, "id">,
    answer: { readonly optionId?: string; readonly text?: string },
  ) => Promise<boolean>;
  readonly onSend: (
    threadId: string,
    text: string,
    effort?: string,
    options?: ComposerSendOptions,
  ) => Promise<boolean>;
  readonly onSetApproval: (threadId: string, policy: string) => Promise<boolean>;
  readonly onSetModel: (threadId: string, model: GraftModelOption) => Promise<boolean>;
  readonly pendingSend?: boolean;
  readonly snapshot: GraftEnvironmentSnapshot | null;
  readonly projectName: string;
  readonly thread: GraftThreadSummary;
}

export function ThreadScreen({
  availableModels,
  connectionState,
  diffSummary,
  error,
  hostLabel,
  initialEffort,
  isRefreshing,
  liveEvents,
  onBack,
  onCancel,
  onLoadDiff,
  onLoadDiffFile,
  onLoadComposerCommands,
  onLoadModels,
  modelCatalog,
  onLoadUsage,
  onRefresh,
  onResolveApproval,
  onResolveQuestion,
  onSend,
  onSetApproval,
  onSetModel,
  pendingSend = false,
  snapshot,
  projectName,
  thread,
}: ThreadScreenProps) {
  const palette = useGraftPalette();
  const insets = useSafeAreaInsets();
  const headerTop = insets.top + 12;
  const headerBottom = headerTop + THREAD_HEADER_HEIGHT;
  const keyboardVisible = useKeyboardVisibility();
  const [draft, setDraft] = useState("");
  const [modelMenuRequest, setModelMenuRequest] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const dictationSendPending = useRef(false);
  const sendInFlight = useRef(false);
  const [bottomChromeHeight, setBottomChromeHeight] = useState(0);
  const [showDiffSheet, setShowDiffSheet] = useState(false);
  const closeDiffSheet = useCallback(() => setShowDiffSheet(false), []);

  const model = useThreadModel({
    availableModels,
    diffSummary,
    initialEffort,
    hasPendingSend: isSending || pendingSend,
    liveEvents,
    snapshot,
    thread,
  });
  const follow = useTranscriptFollow(
    thread.id,
    model.items,
    Boolean(model.activeRunId) &&
      connectionState === "connected" &&
      !model.approval &&
      !model.question,
  );

  const attachments = useComposerAttachments(thread.id);
  const [selectedMode, setSelectedMode] = useState<GraftInteractionMode>();
  const [selectedFastMode, setSelectedFastMode] = useState<boolean>();
  const interactionMode = selectedMode ?? model.currentThread.interactionMode ?? "default";
  const fastMode = Boolean(
    model.currentModel?.supportsFastMode && (selectedFastMode ?? model.currentThread.fastMode),
  );
  const composerFeatures = snapshot?.environment.composerFeatures;
  const attachmentBlocked = attachmentHostError(attachments.attachments, composerFeatures);
  const isConnected = connectionState === "connected";
  // Dictation is local to the phone; a permission Activity can temporarily
  // disconnect the gateway without invalidating the microphone request.
  const voice = useVoiceInput(
    thread.id,
    !isSending && !attachments.isPicking && !model.activeRunId,
    setDraft,
  );
  const canSend = Boolean(
    (draft.trim() || attachments.attachments.length) &&
    isConnected &&
    !isSending &&
    !attachmentBlocked &&
    !attachments.isPicking &&
    !voice.isActive,
  );
  const pendingApproval = model.approval;
  const pendingQuestion = model.question;
  const liveStatus = transcriptLiveStatus({
    items: model.items,
    isWorking: Boolean(isSending || pendingSend || model.activeRunId),
    isConnected,
    needsInput: Boolean(pendingApproval || pendingQuestion),
  });

  useEffect(() => {
    if (isConnected) void onLoadModels();
  }, [isConnected, onLoadModels]);

  useEffect(() => {
    void onLoadDiff(thread.id);
  }, [onLoadDiff, thread.id]);

  useEffect(() => {
    if (model.latestDiffEvent) {
      void onLoadDiff(thread.id, model.latestDiffEvent.diffId ?? thread.id);
    }
  }, [model.latestDiffEvent?.id, onLoadDiff, thread.id]);

  async function send(message = draft, fromDictation = false) {
    const text = message.trim();
    if (
      (!text && !attachments.attachments.length) ||
      !isConnected ||
      sendInFlight.current ||
      attachments.isPicking ||
      attachmentBlocked ||
      (voice.isActive && !fromDictation)
    )
      return;
    if (text === "/model" && !attachments.attachments.length) {
      setDraft("");
      setModelMenuRequest((request) => request + 1);
      return;
    }
    sendInFlight.current = true;
    const sendingAttachments = attachments.attachments;
    const releaseAttachments = attachments.retainForSend();
    setDraft("");
    setIsSending(true);
    follow.pinToBottomForSend();
    let sent = false;
    try {
      sent = await onSend(thread.id, text, model.resolvedEffort, {
        attachments: sendingAttachments,
        ...(composerFeatures?.interactionModes ? { interactionMode } : {}),
        ...(composerFeatures?.fastMode ? { fastMode } : {}),
      });
      if (sent) attachments.remove(sendingAttachments.map((attachment) => attachment.id));
    } finally {
      releaseAttachments();
      sendInFlight.current = false;
      setIsSending(false);
      if (!sent) setDraft(text);
    }
  }

  async function sendDictation() {
    if (dictationSendPending.current) return;
    dictationSendPending.current = true;
    try {
      const text = await voice.stop();
      if (text) await send(text, true);
    } finally {
      dictationSendPending.current = false;
    }
  }

  function handleBottomChromeLayout(event: LayoutChangeEvent) {
    setBottomChromeHeight(event.nativeEvent.layout.height);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.flex, { backgroundColor: palette.background }]}
    >
      <FlatList
        contentContainerStyle={[
          styles.transcript,
          {
            // Clear the composer by enough to also clear the bottom fade
            // (`insets.bottom + 116`) — at 12 the last line settled inside the
            // gradient, which is what "the end of the conversation should be
            // readable above the composer" was asking for.
            paddingBottom: Math.max(insets.bottom + 126, bottomChromeHeight + 24),
            paddingTop: headerBottom + 30,
          },
          model.items.length === 0 ? styles.emptyTranscript : null,
        ]}
        data={model.items}
        initialNumToRender={12}
        keyExtractor={transcriptRowKey}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        maxToRenderPerBatch={8}
        onContentSizeChange={follow.handleContentSizeChange}
        onLayout={follow.handleListLayout}
        onMomentumScrollEnd={follow.handleScrollSettled}
        onScroll={follow.handleScroll}
        onScrollBeginDrag={follow.handleScrollBeginDrag}
        onScrollEndDrag={follow.handleScrollEndDrag}
        onMomentumScrollBegin={follow.handleScrollBeginDrag}
        ref={follow.listRef}
        refreshControl={
          <RefreshControl
            onRefresh={() => void onRefresh()}
            progressViewOffset={headerBottom + 8}
            refreshing={isRefreshing}
            tintColor={palette.foregroundSubtle}
          />
        }
        removeClippedSubviews={false}
        renderItem={renderTranscriptRow}
        scrollEventThrottle={16}
        windowSize={11}
        ListFooterComponent={
          <View style={styles.liveStatusSlot}>
            {liveStatus ? <LiveStatusLine {...liveStatus} /> : null}
          </View>
        }
        ListEmptyComponent={
          isRefreshing ? (
            <ActivityIndicator color={palette.foregroundSubtle} />
          ) : (
            <Text style={[styles.emptyText, { color: palette.foregroundSubtle }]}>
              Start the conversation below.
            </Text>
          )
        }
      />

      <EdgeFade edge="top" style={[styles.topFade, { height: headerBottom + 38 }]} />
      {/* Preserve the PR14 row's 8 dp centering space around its 44 dp controls. */}
      <View style={[styles.topBar, { top: headerTop - 8 }]}>
        <CircleIconButton
          accessibilityLabel="Back to projects"
          icon="chevron-back"
          iconSize={20}
          onPress={onBack}
        />
        <FloatingSurface style={styles.threadHeader}>
          <Text numberOfLines={1} style={[styles.threadHeading, { color: palette.foreground }]}>
            {thread.title}
          </Text>
          <View style={styles.threadContext}>
            <Ionicons color={palette.foregroundSubtle} name="folder-outline" size={12} />
            <Text
              numberOfLines={1}
              style={[styles.threadContextText, { color: palette.foregroundSubtle }]}
            >
              {projectName}
            </Text>
            <Ionicons color={palette.foregroundSubtle} name="laptop-outline" size={12} />
            <Text
              numberOfLines={1}
              style={[styles.threadContextText, { color: palette.foregroundSubtle }]}
            >
              {hostLabel}
            </Text>
          </View>
        </FloatingSurface>
        <FloatingSurface style={styles.threadActions}>
          <UsageMenu
            key={`${thread.id}:${model.currentThread.providerId}`}
            threadId={thread.id}
            contextUsage={model.currentThread.contextUsage}
            onLoadUsage={onLoadUsage}
            trigger={(open) => (
              <PressScale
                accessibilityLabel={contextUsageAccessibilityLabel(
                  model.currentThread.contextUsage,
                )}
                onPress={open}
              >
                <View style={styles.headerActionButton}>
                  <ContextProgressRing palette={palette} usage={model.currentThread.contextUsage} />
                </View>
              </PressScale>
            )}
          />
          <AnchoredMenu
            trigger={(open) => (
              <PressScale accessibilityLabel="Thread options" onPress={open}>
                <View style={styles.headerActionButton}>
                  <Ionicons color={palette.foreground} name="ellipsis-vertical" size={18} />
                </View>
              </PressScale>
            )}
          >
            {(close) => (
              <MenuItem
                label="Refresh"
                onPress={() => {
                  close();
                  void onRefresh();
                }}
              />
            )}
          </AnchoredMenu>
        </FloatingSurface>
      </View>

      <EdgeFade edge="bottom" style={[styles.bottomFade, { height: insets.bottom + 116 }]} />
      <View
        onLayout={handleBottomChromeLayout}
        style={[
          styles.bottomChrome,
          {
            paddingBottom: composerBottomPadding(insets.bottom, keyboardVisible),
          },
        ]}
      >
        {model.taskProgress && !((isSending || pendingSend) && model.taskProgress.isComplete) ? (
          <TaskProgressPill key={model.taskProgress.id} progress={model.taskProgress} />
        ) : null}
        {pendingApproval ? (
          <ApprovalPrompt
            approval={pendingApproval}
            onResolve={(decision) => void onResolveApproval(pendingApproval.id, decision)}
          />
        ) : null}
        {pendingQuestion ? (
          <QuestionPrompt
            onResolve={(answer) => void onResolveQuestion(pendingQuestion, answer)}
            question={pendingQuestion}
          />
        ) : null}
        {error ? (
          <Text numberOfLines={2} style={[styles.inlineError, { color: palette.danger }]}>
            {error}
          </Text>
        ) : null}
        {model.hasDiffChip || follow.isAwayFromBottom ? (
          // Diff pill leading, jump-to-latest arrow trailing, one row — so the
          // two floating chips read as a single chrome band above the composer.
          // Mirrors the `HStack` in the iOS `ThreadView` bottom inset.
          <View style={styles.accessoryRow}>
            {model.hasDiffChip ? (
              <PressScale
                accessibilityLabel={`Changes: ${diffSummary?.files.length ?? 0} files, ${model.diffAdditions} additions, ${model.diffDeletions} deletions`}
                onPress={() => {
                  Vibration.vibrate(10);
                  Keyboard.dismiss();
                  void onLoadDiff(thread.id);
                  setShowDiffSheet(true);
                }}
              >
                <FloatingSurface style={styles.diffChip}>
                  <Text style={[styles.diffLabel, { color: palette.foregroundMuted }]}>
                    {diffSummary?.files.length ?? 0} files changed
                  </Text>
                  {model.diffAdditions > 0 || model.diffDeletions > 0 ? (
                    <>
                      <Text style={[styles.diffCount, { color: palette.success }]}>
                        +{model.diffAdditions}
                      </Text>
                      <Text style={[styles.diffCount, { color: palette.danger }]}>
                        −{model.diffDeletions}
                      </Text>
                    </>
                  ) : null}
                </FloatingSurface>
              </PressScale>
            ) : null}
            <View style={styles.accessorySpacer} />
            {follow.isAwayFromBottom ? (
              <PressScale accessibilityLabel="Jump to latest message" onPress={follow.jumpToLatest}>
                <FloatingSurface style={styles.jumpButton}>
                  <Ionicons color={palette.foreground} name="arrow-down" size={19} />
                </FloatingSurface>
              </PressScale>
            ) : null}
          </View>
        ) : null}
        {draft.startsWith("/") && !/\s/.test(draft) ? (
          <SlashPalette
            query={draft}
            threadId={thread.id}
            providerId={model.currentThread.providerId}
            loadCommands={onLoadComposerCommands}
            onPick={(command) => {
              if (command.kind === "model") {
                setDraft("");
                setModelMenuRequest((request) => request + 1);
              } else {
                setDraft(`/${command.name} `);
              }
            }}
          />
        ) : null}
        <Composer
          attachments={attachments.attachments}
          attachmentError={attachments.error ?? attachmentBlocked}
          onRemoveAttachment={(id) => attachments.remove([id])}
          voice={voice}
          activeRunId={model.activeRunId}
          approvalIsElevated={model.approvalIsElevated}
          canSend={canSend}
          currentApprovalLabel={model.currentApprovalLabel}
          currentModelName={model.currentThread.modelName}
          draft={draft}
          hostLabel={hostLabel}
          isConnected={isConnected}
          isSending={isSending}
          onCancel={(runId) => {
            void onCancel(runId);
          }}
          onDraftChange={setDraft}
          modelMenuRequest={modelMenuRequest}
          menuConfig={{
            catalog: modelCatalog,
            onReloadModels: () => {
              void onLoadModels(true);
            },
            extras: {
              attachmentsEnabled: composerFeatures?.attachments === true,
              modesEnabled: composerFeatures?.interactionModes === true,
              fastModeEnabled: composerFeatures?.fastMode === true,
              interactionMode,
              fastMode,
              busy: isSending || attachments.isPicking || voice.isActive,
              onAttach: (source) => {
                void attachments.pick(source);
              },
              onSelectMode: setSelectedMode,
              onSelectFastMode: setSelectedFastMode,
            },
            currentApproval: model.currentApproval,
            approvalOptions: model.approvalOptions,
            currentModel: model.currentModel,
            models: model.selectableModels,
            efforts: model.efforts,
            resolvedEffort: model.resolvedEffort,
            enabled: isConnected && !isSending,
            onSelectApproval: (policy) => onSetApproval(thread.id, policy),
            onSelectModel: (selected) => {
              if (model.lockedProviderId && selected.providerId !== model.lockedProviderId)
                return false;
              return onSetModel(thread.id, selected);
            },
            onSelectEffort: model.setSelectedEffort,
          }}
          onSend={() => void send()}
          onSendDictation={() => void sendDictation()}
        />
      </View>

      <DiffSheet
        diff={diffSummary}
        onLoadFile={onLoadDiffFile}
        onClose={closeDiffSheet}
        visible={showDiffSheet}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  liveStatusSlot: { minHeight: 24 },
  transcript: { flexGrow: 1, gap: 16, paddingHorizontal: 16 },
  emptyTranscript: { justifyContent: "center" },
  emptyText: { fontSize: 14, textAlign: "center" },
  topFade: { top: 0 },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    height: THREAD_HEADER_HEIGHT + 16,
    gap: 8,
    // Matches `bottomChrome`, so the floating circles share an edge with the
    // composer below them.
    left: 12,
    position: "absolute",
    right: 12,
    top: 0,
  },
  threadHeading: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  threadHeader: {
    flex: 1,
    height: THREAD_HEADER_HEIGHT,
    justifyContent: "center",
    maxWidth: 300,
    paddingHorizontal: 12,
  },
  threadContext: { alignItems: "center", flexDirection: "row", gap: 4 },
  threadContextText: { flexShrink: 1, fontSize: 11, lineHeight: 14 },
  threadActions: {
    alignItems: "center",
    flexDirection: "row",
    height: THREAD_HEADER_HEIGHT,
    overflow: "hidden",
  },
  headerActionButton: {
    alignItems: "center",
    height: THREAD_HEADER_HEIGHT,
    justifyContent: "center",
    width: THREAD_HEADER_HEIGHT,
  },
  bottomFade: { bottom: 0 },
  bottomChrome: {
    bottom: 0,
    gap: 10,
    left: 12,
    position: "absolute",
    right: 12,
  },
  accessoryRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  accessorySpacer: { flex: 1, minWidth: 0 },
  jumpButton: {
    alignItems: "center",
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  inlineError: { fontSize: 12, marginHorizontal: 12, textAlign: "center" },
  diffChip: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    minHeight: 36,
    paddingHorizontal: 14,
  },
  diffLabel: { fontSize: 13, fontWeight: "600" },
  diffCount: { fontFamily: "monospace", fontSize: 13, fontWeight: "600" },
});
