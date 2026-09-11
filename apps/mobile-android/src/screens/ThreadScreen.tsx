import { Ionicons } from "@expo/vector-icons";
import type {
  GraftApprovalDecision,
  GraftDiffSummary,
  GraftEnvironmentSnapshot,
  GraftModelOption,
  GraftQuestionRequest,
  GraftThreadSummary,
  GraftTimelineEvent,
} from "@graft/mobile-contract";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { CircleIconButton } from "../components/CircleIconButton";
import { EdgeFade } from "../components/EdgeFade";
import { FloatingSurface } from "../components/FloatingSurface";
import { LiveStatusLine } from "../components/LiveStatusLine";
import { PressScale } from "../components/PressScale";
import { livePhraseFromItems, shouldShowStreamingFooter } from "../state/liveStatus";
import { useGraftPalette } from "../theme/tokens";
import { Composer } from "./thread/Composer";
import { composerBottomPadding } from "./thread/composerBottomSpacing";
import { ComposerConfigMenu } from "./thread/ComposerConfigMenu";
import { ContextProgressRing } from "./thread/ContextProgressRing";
import { contextUsageAccessibilityLabel, contextUsageDetail } from "./thread/contextUsage";
import { DiffSheet } from "./thread/DiffSheet";
import { ApprovalPrompt, QuestionPrompt } from "./thread/InteractionPrompts";
import { ApprovalPickerSheet, ComposerActionsSheet, ModelPickerSheet } from "./thread/ThreadSheets";
import { renderTranscriptRow, transcriptRowKey } from "./thread/TranscriptRow";
import { useThreadModel } from "./thread/useThreadModel";
import { useKeyboardVisibility } from "./thread/useKeyboardVisibility";
import { useTranscriptFollow } from "./thread/useTranscriptFollow";

interface ThreadScreenProps {
  readonly availableModels: readonly GraftModelOption[];
  readonly connectionState: GatewayConnectionState;
  readonly diffSummary?: GraftDiffSummary;
  readonly error?: string;
  readonly isRefreshing: boolean;
  readonly hostLabel: string;
  readonly initialEffort?: string;
  readonly liveEvents: readonly GraftTimelineEvent[];
  readonly onBack: () => void;
  readonly onCancel: (runId: string) => Promise<boolean>;
  readonly onLoadDiff: (threadId: string, diffId?: string) => Promise<void>;
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
  onLoadModels,
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
  const [showApprovalSheet, setShowApprovalSheet] = useState(false);
  const [showActionsSheet, setShowActionsSheet] = useState(false);
  const [showDiffSheet, setShowDiffSheet] = useState(false);
  const [showIntelligenceMenu, setShowIntelligenceMenu] = useState(false);
  const [showModelSheet, setShowModelSheet] = useState(false);

  const model = useThreadModel({
    availableModels,
    diffSummary,
    initialEffort,
    liveEvents,
    snapshot,
    thread,
  });
  const follow = useTranscriptFollow(model.activeRunId);

  const isConnected = connectionState === "connected";
  const canSend = Boolean(draft.trim() && isConnected && !isSending);
  const pendingApproval = model.approval;
  const pendingQuestion = model.question;
  const showLiveStatus = shouldShowStreamingFooter(
    Boolean(isSending || pendingSend || model.activeRunId),
  );
  const livePhrase = livePhraseFromItems(model.items);

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
            paddingTop: insets.top + 84,
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
        onScrollEndDrag={follow.handleScrollSettled}
        ref={follow.listRef}
        refreshControl={
          <RefreshControl
            onRefresh={() => void onRefresh()}
            progressViewOffset={insets.top + 50}
            refreshing={isRefreshing}
            tintColor={palette.foregroundSubtle}
          />
        }
        removeClippedSubviews
        renderItem={renderTranscriptRow}
        scrollEventThrottle={16}
        windowSize={11}
        ListFooterComponent={showLiveStatus ? <LiveStatusLine phrase={livePhrase} /> : null}
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

      <EdgeFade edge="top" style={[styles.topFade, { height: insets.top + 92 }]} />
      <View style={[styles.topBar, { paddingTop: insets.top }]}>
        <CircleIconButton
          accessibilityLabel="Back to projects"
          icon="chevron-back"
          iconSize={22}
          onPress={onBack}
        />
        <FloatingSurface style={styles.threadHeader}>
          <Text numberOfLines={1} style={[styles.threadHeading, { color: palette.foreground }]}>
            {thread.title}
          </Text>
          <View style={styles.threadContext}>
            <Ionicons color={palette.foregroundSubtle} name="folder-outline" size={13} />
            <Text
              numberOfLines={1}
              style={[styles.threadContextText, { color: palette.foregroundSubtle }]}
            >
              {projectName}
            </Text>
            <Ionicons color={palette.foregroundSubtle} name="laptop-outline" size={13} />
            <Text
              numberOfLines={1}
              style={[styles.threadContextText, { color: palette.foregroundSubtle }]}
            >
              {hostLabel}
            </Text>
          </View>
        </FloatingSurface>
        <FloatingSurface style={styles.threadActions}>
          <PressScale
            accessibilityLabel={contextUsageAccessibilityLabel(model.currentThread.contextUsage)}
            onPress={() =>
              Alert.alert("Context", contextUsageDetail(model.currentThread.contextUsage))
            }
          >
            <View style={styles.headerActionButton}>
              <ContextProgressRing palette={palette} usage={model.currentThread.contextUsage} />
            </View>
          </PressScale>
          <PressScale
            accessibilityLabel="Thread options"
            onPress={() =>
              Alert.alert(thread.title, undefined, [
                { text: "Refresh", onPress: () => void onRefresh() },
                { text: "Cancel", style: "cancel" },
              ])
            }
          >
            <View style={styles.headerActionButton}>
              <Ionicons color={palette.foreground} name="ellipsis-vertical" size={22} />
            </View>
          </PressScale>
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
          onOpenActions={() => setShowActionsSheet(true)}
          onOpenApproval={() => setShowApprovalSheet(true)}
          onOpenModel={() => setShowIntelligenceMenu(true)}
          onSend={() => void send()}
          resolvedEffort={model.resolvedEffort}
        />
      </View>

      <ApprovalPickerSheet
        currentApproval={model.currentApproval}
        onClose={() => setShowApprovalSheet(false)}
        onSelect={(policy) => {
          void onSetApproval(thread.id, policy);
        }}
        options={model.approvalOptions}
        visible={showApprovalSheet}
      />

      <ComposerActionsSheet
        hasApprovalOptions={model.approvalOptions.length > 0}
        onClose={() => setShowActionsSheet(false)}
        onOpenApproval={() => setShowApprovalSheet(true)}
        onOpenModel={() => setShowIntelligenceMenu(true)}
        visible={showActionsSheet}
      />

      <ComposerConfigMenu
        currentModel={model.currentModel}
        efforts={model.efforts}
        onClose={() => setShowIntelligenceMenu(false)}
        onOpenModel={() => {
          setShowIntelligenceMenu(false);
          setShowModelSheet(true);
        }}
        onSelectEffort={model.setSelectedEffort}
        onSpeedPress={() => Alert.alert("Speed", "Normal is currently the supported host speed.")}
        resolvedEffort={model.resolvedEffort}
        visible={showIntelligenceMenu}
      />

      <ModelPickerSheet
        currentModel={model.currentModel}
        efforts={model.efforts}
        models={availableModels}
        onClose={() => setShowModelSheet(false)}
        onSelectEffort={model.setSelectedEffort}
        onSelectModel={(selected) => {
          void onSetModel(thread.id, selected);
        }}
        resolvedEffort={model.resolvedEffort}
        visible={showModelSheet}
      />

      <DiffSheet
        diff={diffSummary}
        onClose={() => setShowDiffSheet(false)}
        visible={showDiffSheet}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  transcript: { flexGrow: 1, gap: 16, paddingHorizontal: 16 },
  emptyTranscript: { justifyContent: "center" },
  emptyText: { fontSize: 14, textAlign: "center" },
  topFade: { top: 0 },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    height: 70,
    gap: 8,
    // Matches `bottomChrome`, so the floating circles share an edge with the
    // composer below them.
    left: 12,
    position: "absolute",
    right: 12,
    top: 0,
  },
  threadHeading: {
    fontSize: 14,
    fontWeight: "600",
  },
  threadHeader: {
    flex: 1,
    height: 54,
    justifyContent: "center",
    maxWidth: 300,
    paddingHorizontal: 15,
  },
  threadContext: { alignItems: "center", flexDirection: "row", gap: 4 },
  threadContextText: { flexShrink: 1, fontSize: 11 },
  threadActions: {
    alignItems: "center",
    flexDirection: "row",
    height: 54,
    overflow: "hidden",
  },
  headerActionButton: {
    alignItems: "center",
    height: 54,
    justifyContent: "center",
    width: 42,
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
