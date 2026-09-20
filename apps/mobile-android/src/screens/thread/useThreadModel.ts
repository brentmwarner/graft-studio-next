import type {
  GraftApprovalPolicyOption,
  GraftDiffSummary,
  GraftEnvironmentSnapshot,
  GraftModelOption,
  GraftThreadSummary,
  GraftTimelineEvent,
} from "@graft/mobile-contract";
import { useMemo, useRef, useState } from "react";

import { reconcileTranscriptItems, type TranscriptItem } from "../../state/mobileViewModels";
import { deriveTaskProgress, type TaskProgress } from "../../state/taskProgress";
import { threadRunState } from "../../state/threadRunState";
import { presentTranscript } from "./presentTranscript";
import { useReconciledTranscript } from "./TranscriptRow";
import { modelSelectionId, resolveModelEffort, threadModelChoices } from "./threadModels";

/// Stable empty slice so a thread with no settled transcript doesn't mint a new
/// array identity on every render and defeat the transcript memo below.
const NO_EVENTS: readonly GraftTimelineEvent[] = [];

export interface ThreadModel {
  readonly activeRunId: string | undefined;
  readonly isWorking: boolean;
  readonly approval: GraftEnvironmentSnapshot["pendingApprovals"][number] | undefined;
  readonly approvalOptions: readonly GraftApprovalPolicyOption[];
  readonly currentApproval: string | undefined;
  readonly currentModel: GraftModelOption | undefined;
  readonly currentThread: GraftThreadSummary;
  readonly lockedProviderId: string | undefined;
  readonly selectableModels: readonly GraftModelOption[];
  readonly diffAdditions: number;
  readonly diffDeletions: number;
  readonly efforts: readonly string[];
  readonly hasDiffChip: boolean;
  readonly items: readonly TranscriptItem[];
  readonly followItems: readonly TranscriptItem[];
  readonly taskProgress: TaskProgress | undefined;
  readonly latestDiffEvent: GraftTimelineEvent | undefined;
  readonly question: GraftEnvironmentSnapshot["pendingQuestions"][number] | undefined;
  readonly resolvedEffort: string | undefined;
  readonly selectedEffort: string | undefined;
  readonly setSelectedEffort: (effort: string | undefined) => void;
}

export function useThreadModel({
  availableModels,
  diffSummary,
  initialEffort,
  hasPendingSend = false,
  liveEvents,
  snapshot,
  thread,
}: {
  readonly availableModels: readonly GraftModelOption[];
  readonly diffSummary?: GraftDiffSummary;
  readonly initialEffort?: string;
  readonly hasPendingSend?: boolean;
  readonly liveEvents: readonly GraftTimelineEvent[];
  readonly snapshot: GraftEnvironmentSnapshot | null;
  readonly thread: GraftThreadSummary;
}): ThreadModel {
  const [effortChoice, setEffortChoice] = useState({
    modelId: JSON.stringify([thread.providerId, thread.modelName]),
    effort: initialEffort,
  });
  const currentThread = snapshot?.threads.find((candidate) => candidate.id === thread.id) ?? thread;
  const selectedTranscript =
    snapshot?.selectedTranscript?.threadId === thread.id ? snapshot.selectedTranscript : undefined;
  const transcript = selectedTranscript?.events ?? NO_EVENTS;
  // The journal position the settled transcript was taken at. Without a
  // snapshot for this thread yet there is nothing to dedupe against, so 0 keeps
  // the whole streamed tail rather than silently swallowing it.
  const transcriptCursor = selectedTranscript?.cursor ?? 0;
  const threadLiveEvents = useMemo(
    () => liveEvents.filter((event) => event.threadId === thread.id),
    [liveEvents, thread.id],
  );
  const latestDiffEvent = useMemo(
    () => [...threadLiveEvents].reverse().find((event) => event.kind === "diff.updated"),
    [threadLiveEvents],
  );
  const transcriptItems = useReconciledTranscript(transcript, threadLiveEvents, transcriptCursor);
  const followItems = useMemo(
    () =>
      transcriptItems.filter(
        (item) =>
          item.kind !== "activity" ||
          (item.data?.type !== "plan" && item.data?.type !== "todo_update"),
      ),
    [transcriptItems],
  );
  const taskProgress = useMemo(
    () =>
      deriveTaskProgress([
        ...transcript,
        ...threadLiveEvents.filter(
          (event) => event.cursor === 0 || event.cursor > transcriptCursor,
        ),
      ]),
    [transcript, threadLiveEvents, transcriptCursor],
  );
  const activeRun = snapshot?.activeRuns.find((run) => run.threadId === thread.id);
  const { activeRunId, isWorking } = threadRunState(
    activeRun,
    threadLiveEvents,
    snapshot?.cursor ?? 0,
    currentThread.status === "running",
  );
  const presentedRef = useRef<readonly TranscriptItem[]>([]);
  const items = useMemo(() => {
    const presented = reconcileTranscriptItems(
      presentedRef.current,
      presentTranscript(followItems, isWorking || hasPendingSend, activeRunId),
    );
    presentedRef.current = presented;
    return presented;
  }, [followItems, isWorking, hasPendingSend, activeRunId]);
  const approval = snapshot?.pendingApprovals.find((item) => item.threadId === thread.id);
  const question = snapshot?.pendingQuestions.find((item) => item.threadId === thread.id);
  const { currentModel, lockedProviderId, selectableModels } = threadModelChoices(
    currentThread,
    availableModels,
    hasPendingSend || items.length > 0 || Boolean(activeRun),
  );
  const efforts = currentModel?.reasoningEfforts ?? [];
  const modelId = currentModel ? modelSelectionId(currentModel) : undefined;
  const selectedEffort = effortChoice.modelId === modelId ? effortChoice.effort : undefined;
  const resolvedEffort = resolveModelEffort(currentModel, selectedEffort, currentThread.effort);
  const setSelectedEffort = (effort: string | undefined) => {
    if (modelId) setEffortChoice({ modelId, effort });
  };
  const approvalOptions = currentThread.approvalPolicyOptions ?? [];
  const currentApproval = currentThread.approvalPolicy ?? approvalOptions[0]?.value;
  const diffAdditions =
    diffSummary?.files.reduce((total, file) => total + (file.additions ?? 0), 0) ?? 0;
  const diffDeletions =
    diffSummary?.files.reduce((total, file) => total + (file.deletions ?? 0), 0) ?? 0;
  const hasDiffChip = Boolean(diffSummary && diffSummary.files.length > 0);

  return {
    activeRunId,
    isWorking,
    approval,
    approvalOptions,
    currentApproval,
    currentModel,
    currentThread,
    lockedProviderId,
    selectableModels,
    diffAdditions,
    diffDeletions,
    efforts,
    hasDiffChip,
    items,
    followItems,
    taskProgress,
    latestDiffEvent,
    question,
    resolvedEffort,
    selectedEffort,
    setSelectedEffort,
  };
}
