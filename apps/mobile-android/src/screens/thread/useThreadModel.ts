import type {
  GraftApprovalPolicyOption,
  GraftDiffSummary,
  GraftEnvironmentSnapshot,
  GraftModelOption,
  GraftRunStatus,
  GraftThreadSummary,
  GraftTimelineEvent,
} from "@graft/mobile-contract";
import { useMemo, useState } from "react";

import { presentTranscriptRows, type TranscriptItem } from "../../state/mobileViewModels";
import { deriveTaskProgress, type TaskProgress } from "../../state/taskProgress";
import { useReconciledTranscript } from "./TranscriptRow";
import { modelSelectionId, resolveModelEffort, threadModelChoices } from "./threadModels";

/// Stable empty slice so a thread with no settled transcript doesn't mint a new
/// array identity on every render and defeat the transcript memo below.
const NO_EVENTS: readonly GraftTimelineEvent[] = [];

const RUN_IS_ACTIVE: Record<GraftRunStatus, boolean> = {
  queued: true,
  running: true,
  waiting: true,
  completed: false,
  failed: false,
  cancelled: false,
};

export interface ThreadModel {
  readonly activeRunId: string | undefined;
  readonly approval: GraftEnvironmentSnapshot["pendingApprovals"][number] | undefined;
  readonly approvalIsElevated: boolean;
  readonly approvalOptions: readonly GraftApprovalPolicyOption[];
  readonly currentApproval: string | undefined;
  readonly currentApprovalLabel: string;
  readonly currentModel: GraftModelOption | undefined;
  readonly currentThread: GraftThreadSummary;
  readonly lockedProviderId: string | undefined;
  readonly selectableModels: readonly GraftModelOption[];
  readonly diffAdditions: number;
  readonly diffDeletions: number;
  readonly efforts: readonly string[];
  readonly hasDiffChip: boolean;
  readonly items: readonly TranscriptItem[];
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
  const activeRun = snapshot?.activeRuns.find(
    (run) => run.threadId === thread.id && RUN_IS_ACTIVE[run.status],
  );
  const latestRunStatus = useMemo(
    () =>
      [...threadLiveEvents]
        .reverse()
        .find((event) => event.kind === "run.status" && event.runId === activeRun?.id)?.runStatus,
    [activeRun?.id, threadLiveEvents],
  );
  const activeRunId =
    activeRun && (!latestRunStatus || RUN_IS_ACTIVE[latestRunStatus]) ? activeRun.id : undefined;
  const items = useMemo(
    () =>
      presentTranscriptRows(
        transcriptItems.filter(
          (item) =>
            item.kind !== "activity" ||
            (item.data?.type !== "plan" && item.data?.type !== "todo_update"),
        ),
        Boolean(activeRunId || hasPendingSend),
      ),
    [activeRunId, hasPendingSend, transcriptItems],
  );
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
  const currentApprovalLabel =
    approvalOptions.find((option) => option.value === currentApproval)?.label ?? "Permissions";
  const approvalIsElevated = Boolean(
    currentApproval && approvalOptions[0] && currentApproval !== approvalOptions[0].value,
  );
  const diffAdditions =
    diffSummary?.files.reduce((total, file) => total + (file.additions ?? 0), 0) ?? 0;
  const diffDeletions =
    diffSummary?.files.reduce((total, file) => total + (file.deletions ?? 0), 0) ?? 0;
  const hasDiffChip = Boolean(diffSummary && diffSummary.files.length > 0);

  return {
    activeRunId,
    approval,
    approvalIsElevated,
    approvalOptions,
    currentApproval,
    currentApprovalLabel,
    currentModel,
    currentThread,
    lockedProviderId,
    selectableModels,
    diffAdditions,
    diffDeletions,
    efforts,
    hasDiffChip,
    items,
    taskProgress,
    latestDiffEvent,
    question,
    resolvedEffort,
    selectedEffort,
    setSelectedEffort,
  };
}
