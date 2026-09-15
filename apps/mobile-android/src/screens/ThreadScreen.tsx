import { Ionicons } from "@expo/vector-icons";
import type {
  GraftApprovalDecision,
  GraftDiffSummary,
  GraftEnvironmentSnapshot,
  GraftModelOption,
  GraftQuestionRequest,
  GraftThreadSummary,
  GraftThreadUsage,
  GraftTimelineEvent,
} from "@graft/mobile-contract";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
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
import { useGraftPalette } from "../theme/tokens";
import { Composer } from "./thread/Composer";
import { composerBottomPadding } from "./thread/composerBottomSpacing";
import { ContextProgressRing } from "./thread/ContextProgressRing";
import { contextUsageAccessibilityLabel } from "./thread/contextUsage";
import { DiffSheet } from "./thread/DiffSheet";
import { ApprovalPrompt, QuestionPrompt } from "./thread/InteractionPrompts";
import { renderTranscriptRow, transcriptRowKey } from "./thread/TranscriptRow";
import { useThreadModel } from "./thread/useThreadModel";
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
  readonly onLoadModels: () => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onResolveApproval: (
    approvalId: string,
    decision: GraftApprovalDecision,
  ) => Promise<boolean>;
  readonly onResolveQuestion: (
    question: Pick<GraftQuestionRequest, "id">,
    answer: { readonly optionId?: string; readonly text?: string },
  ) => Promise<boolean>;
  readonly onSend: (threadId: string, text: string, effort?: string) => Promise<boolean>;
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
  onLoadModels,
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
  const keyboardVisible = useKeyboardVisibility();
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [bottomChromeHeight, setBottomChromeHeight] = useState(0);
  const [showDiffSheet, setShowDiffSheet] = useState(false);
  const closeDiffSheet = useCallback(() => setShowDiffSheet(false), []);

  const model = useThreadModel({
    availableModels,
    diffSummary,
    initialEffort,
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

  const isConnected = connectionState === "connected";
  const canSend = Boolean(draft.trim() && isConnected && !isSending);
  const pendingApproval = model.approval;
  const pendingQuestion = model.question;
  const liveStatus = transcriptLiveStatus({
    items: model.items,
    isWorking: Boolean(isSending || pendingSend || model.activeRunId),
    isConnected,
    needsInput: Boolean(pendingApproval || pendingQuestion),
  });

  useEffect(() => {
    void onLoadModels();
    void onLoadDiff(thread.id);
  }, [onLoadDiff, onLoadModels, thread.id]);

  useEffect(() => {
    if (model.latestDiffEvent) {
      void onLoadDiff(thread.id, model.latestDiffEvent.diffId ?? thread.id);
    }
  }, [model.latestDiffEvent?.id, onLoadDiff, thread.id]);

  async function send() {
    const text = draft.trim();
    if (!text || isSending) return;
    setDraft("");
    setIsSending(true);
    follow.pinToBottomForSend();
    const sent = await onSend(thread.id, text, model.resolvedEffort);
    setIsSending(false);
    if (!sent) setDraft(text);
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
            paddingTop: insets.top + THREAD_HEADER_HEIGHT + 30,
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
            progressViewOffset={insets.top + 50}
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

      <EdgeFade
        edge="top"
        style={[styles.topFade, { height: insets.top + THREAD_HEADER_HEIGHT + 38 }]}
      />
      <View style={[styles.topBar, { paddingTop: insets.top }]}>
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
                onPress={() => setShowDiffSheet(true)}
              >
                <FloatingSurface style={styles.diffChip}>
                  <Text style={[styles.diffLabel, { color: palette.foregroundMuted }]}>
                    {diffSummary?.files.length ?? 0} files changed
                  </Text>
                  <Text style={[styles.diffCount, { color: palette.success }]}>
                    +{model.diffAdditions}
                  </Text>
                  <Text style={[styles.diffCount, { color: palette.danger }]}>
                    −{model.diffDeletions}
                  </Text>
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
        <Composer
          activeRunId={model.activeRunId}
          approvalIsElevated={model.approvalIsElevated}
          availableModels={availableModels}
          canSend={canSend}
          currentApprovalLabel={model.currentApprovalLabel}
          currentModel={model.currentModel}
          currentModelName={model.currentThread.modelName}
          draft={draft}
          canChangeApproval={model.canChangeApproval}
          hasApprovalOptions={model.approvalOptions.length > 0}
          hostLabel={hostLabel}
          isConnected={isConnected}
          isSending={isSending}
          onCancel={(runId) => {
            void onCancel(runId);
          }}
          onDraftChange={setDraft}
          menuConfig={{
            currentApproval: model.currentApproval,
            approvalOptions: model.approvalOptions,
            currentModel: model.currentModel,
            models: availableModels,
            efforts: model.efforts,
            resolvedEffort: model.resolvedEffort,
            enabled: isConnected,
            onSelectApproval: (policy) => onSetApproval(thread.id, policy),
            onSelectModel: (selected) => onSetModel(thread.id, selected),
            onSelectEffort: model.setSelectedEffort,
          }}
          onSend={() => void send()}
          resolvedEffort={model.resolvedEffort}
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
