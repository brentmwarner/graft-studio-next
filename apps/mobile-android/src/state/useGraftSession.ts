import {
  assertNeverMobile,
  type GraftApprovalDecision,
  type GraftDiffSummary,
  type GraftEnvironmentSnapshot,
  type GraftMobileCommandResult,
  type GraftMobileHostMessage,
  type GraftModelOption,
  type GraftQuestionRequest,
  type GraftRunSummary,
  type GraftSessionCredential,
  type GraftThreadSummary,
  type GraftTimelineEvent,
} from "@graft/mobile-contract";
import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import { File } from "expo-file-system";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { AppState } from "react-native";

import { createGatewayClient, GatewayError } from "../api/gateway";
import { watchGatewayNetwork } from "../api/gatewayNetwork";
import {
  GatewaySocket,
  GatewaySocketError,
  type GatewayConnectionState,
} from "../api/gatewaySocket";
import {
  sendWithAttachments,
  type ComposerSendAttempt,
  type ComposerSendOptions,
} from "../screens/thread/composerAttachmentSend";
import { parsePairingInput } from "../protocol/pairing";
import { getDeviceIdentity } from "../storage/deviceIdentity";
import { clearSession, loadSession, saveSession } from "../storage/sessionRepository";

import { loadCachedSnapshot, saveCachedSnapshot } from "../storage/snapshotCache";
import { isOfflineError } from "./connectionStatus";

import { useModelCatalog } from "./useModelCatalog";
import { mergeTimelineEvents } from "./mobileViewModels";
import { reconcileLiveUserMessages, type LocalTimelineEvent } from "./optimisticMessages";

interface LoadingState {
  readonly status: "loading";
}

interface UnpairedState {
  readonly status: "unpaired";
  readonly error?: string;
  readonly pendingInput?: string;
}

interface PairingState {
  readonly status: "pairing";
  readonly pendingInput?: string;
  readonly error?: string;
}

export interface PairedState {
  readonly status: "paired";
  readonly session: GraftSessionCredential;
  readonly snapshot: GraftEnvironmentSnapshot | null;
  readonly liveEvents: readonly GraftTimelineEvent[];
  readonly diffs: Readonly<Record<string, GraftDiffSummary>>;
  readonly connectionState: GatewayConnectionState;
  readonly isRefreshing: boolean;
  readonly error?: string;
}

export type GraftSessionState = LoadingState | UnpairedState | PairingState | PairedState;

export interface CreateThreadOptions {
  readonly approvalPolicy?: string;
  readonly mode?: "local" | "worktree";
  readonly model?: GraftModelOption;
}

const gateway = createGatewayClient();
const SNAPSHOT_COALESCE_MS = 220;

function messageFor(error: unknown): string {
  if (error instanceof GatewayError || error instanceof GatewaySocketError) {
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

function withRun(
  snapshot: GraftEnvironmentSnapshot | null,
  run: GraftRunSummary,
): GraftEnvironmentSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    activeRuns: [run, ...snapshot.activeRuns.filter((candidate) => candidate.id !== run.id)],
  };
}

function withThread(
  snapshot: GraftEnvironmentSnapshot | null,
  thread: GraftThreadSummary,
): GraftEnvironmentSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    threads: snapshot.threads.map((candidate) => (candidate.id === thread.id ? thread : candidate)),
  };
}

function requireResult<TType extends GraftMobileCommandResult["type"]>(
  result: GraftMobileCommandResult | undefined,
  type: TType,
): Extract<GraftMobileCommandResult, { type: TType }> {
  if (result?.type !== type) {
    throw new GatewaySocketError("Graft Studio returned an unexpected response.");
  }
  return result as Extract<GraftMobileCommandResult, { type: TType }>;
}

function requireSocket(socket: GatewaySocket | null): GatewaySocket {
  if (!socket) {
    throw new GatewaySocketError(
      "Pair with Graft Studio before sending a message.",
      "not_connected",
    );
  }
  return socket;
}

type PairedUpdater = (current: PairedState) => PairedState;

async function runSocketCommand<TType extends GraftMobileCommandResult["type"]>(
  socket: GatewaySocket | null,
  command: Parameters<GatewaySocket["command"]>[0],
  resultType: TType,
  commandId?: string,
): Promise<Extract<GraftMobileCommandResult, { type: TType }>> {
  return requireResult(await requireSocket(socket).command(command, commandId), resultType);
}

function updatePaired(
  setState: Dispatch<SetStateAction<GraftSessionState>>,
  update: PairedUpdater,
): void {
  setState((current) => (current.status === "paired" ? update(current) : current));
}

function setPairedError(
  setState: Dispatch<SetStateAction<GraftSessionState>>,
  error: unknown,
): void {
  updatePaired(setState, (current) => ({
    ...current,
    error: isOfflineError(error) ? undefined : messageFor(error),
  }));
}

export function useGraftSession(initialSession?: GraftSessionCredential | null) {
  const [state, setState] = useState<GraftSessionState>({ status: "loading" });
  const [pendingSendThreadId, setPendingSendThreadId] = useState<string | undefined>();
  const sessionRef = useRef<GraftSessionCredential | null>(null);
  const selectedThreadIdRef = useRef<string | undefined>(undefined);
  const connectionStateRef = useRef<GatewayConnectionState>("disconnected");
  const socketRef = useRef<GatewaySocket | null>(null);
  const sendAttemptsRef = useRef(new Map<string, ComposerSendAttempt>());
  const sendingThreadsRef = useRef(new Set<string>());
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /// Latest cursor the authoritative snapshot covers. Mirrors the iOS
  /// `AppModel` guard: a streamed frame the snapshot already accounts for
  /// doesn't need another HTTP round trip, and reading it from a ref keeps the
  /// socket and AppState effects off the render-state dependency treadmill.
  const snapshotCursorRef = useRef(0);
  /// Monotonic generation for snapshot requests. Requests overlap routinely —
  /// a coalesced background refresh can still be in flight when the user opens
  /// another thread — and responses are not ordered. Without this, an older
  /// response landing last would overwrite the current thread's transcript and
  /// regress `snapshotCursorRef`, leaving the just-opened thread blank until
  /// something else triggered a refresh. Only the newest request may apply.
  const snapshotRequestRef = useRef(0);

  const refreshSnapshot = useCallback(
    async (session: GraftSessionCredential, threadId: string | undefined, showRefresh: boolean) => {
      const requestId = (snapshotRequestRef.current += 1);

      if (showRefresh) {
        setState((current) =>
          current.status === "paired" && current.session.sessionId === session.sessionId
            ? { ...current, isRefreshing: true, error: undefined }
            : current,
        );
      }

      try {
        const snapshot = await gateway.snapshot(session, threadId);
        if (snapshot.environment.id !== session.environmentId)
          throw new GatewayError("Snapshot belongs to another computer.", "invalid_response");
        if (snapshotRequestRef.current !== requestId) return;
        saveCachedSnapshot(snapshot);
        socketRef.current?.updateCursor(snapshot.cursor);
        snapshotCursorRef.current = snapshot.cursor;
        setState((current) =>
          current.status === "paired" && current.session.sessionId === session.sessionId
            ? {
                ...current,
                snapshot,
                // A snapshot's cursor is environment-wide, while its selected
                // transcript can briefly lag behind a just-started turn. Keep
                // the bounded live tail and let the transcript merger dedupe
                // events against the selected thread's actual event cursors.
                liveEvents: reconcileLiveUserMessages(
                  snapshot.selectedTranscript?.events ?? [],
                  current.liveEvents,
                ).slice(-2_000),
                isRefreshing: false,
                error: undefined,
              }
            : current,
        );
      } catch (error) {
        // A superseded request's failure is not the current view's failure;
        // surfacing it would show an error banner over a healthy transcript.
        if (snapshotRequestRef.current !== requestId) return;
        setState((current) =>
          current.status === "paired" && current.session.sessionId === session.sessionId
            ? {
                ...current,
                isRefreshing: false,
                error: isOfflineError(error) ? undefined : messageFor(error),
              }
            : current,
        );
      }
    },
    [],
  );

  const scheduleSnapshot = useCallback(
    (immediately = false) => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = setTimeout(
        () => {
          snapshotTimerRef.current = undefined;
          const session = sessionRef.current;
          if (session && connectionStateRef.current === "connected") {
            void refreshSnapshot(session, selectedThreadIdRef.current, false);
          }
        },
        immediately ? 0 : SNAPSHOT_COALESCE_MS,
      );
    },
    [refreshSnapshot],
  );

  const handleHostMessage = useCallback(
    (message: GraftMobileHostMessage) => {
      switch (message.envelope) {
        case "welcome":
          scheduleSnapshot(true);
          break;
        case "event":
          // The streamed frame paints the in-flight turn immediately; the
          // snapshot refresh is the authoritative reconcile behind it. Skip
          // that round trip when the snapshot already covers this cursor.
          setState((current) =>
            current.status === "paired"
              ? {
                  ...current,
                  liveEvents: reconcileLiveUserMessages(
                    current.snapshot?.selectedTranscript?.events ?? [],
                    [...current.liveEvents, message.event],
                  ).slice(-2_000),
                }
              : current,
          );
          if (message.event.cursor > snapshotCursorRef.current) {
            scheduleSnapshot();
          }
          break;
        case "response":
        case "snapshot_required":
          scheduleSnapshot(message.envelope === "snapshot_required");
          break;
        case "error":
          setState((current) =>
            current.status === "paired"
              ? {
                  ...current,
                  error: message.error.code === "host_offline" ? undefined : message.error.message,
                }
              : current,
          );
          if (message.error.code === "device_revoked") {
            // Tear the transport down synchronously, before awaiting the
            // storage clear. The host closes the connection right after this
            // frame, and `GatewaySocket`'s onclose reconnects while `desired`
            // is still true — so without this the app retries the revoked
            // credential forever from the unpaired screen. Bumping the
            // snapshot generation likewise strands any in-flight snapshot so a
            // late response can't repaint a session we just dropped.
            socketRef.current?.disconnect();
            snapshotRequestRef.current += 1;
            if (snapshotTimerRef.current) {
              clearTimeout(snapshotTimerRef.current);
              snapshotTimerRef.current = undefined;
            }
            const removedSession = sessionRef.current;
            sessionRef.current = null;
            sendAttemptsRef.current.clear();
            snapshotCursorRef.current = 0;
            void (
              removedSession
                ? clearSession(removedSession.environmentId, removedSession.sessionId)
                : Promise.resolve()
            ).then(
              () => setState({ status: "unpaired", error: "This device was disconnected." }),
              (error: unknown) => setPairedError(setState, error),
            );
          }
          break;
        case "pong":
          break;
        default:
          assertNeverMobile(message);
      }
    },
    [scheduleSnapshot],
  );

  useEffect(() => {
    const socket = new GatewaySocket({
      onMessage: handleHostMessage,
      onStateChange: (connectionState) => {
        connectionStateRef.current = connectionState;
        setState((current) =>
          current.status === "paired" ? { ...current, connectionState } : current,
        );
      },
    });
    socketRef.current = socket;
    const stopWatchingNetwork = watchGatewayNetwork(socket);
    return () => {
      stopWatchingNetwork();
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      socket.disconnect();
      socketRef.current = null;
      snapshotRequestRef.current += 1;
      sessionRef.current = null;
    };
  }, [handleHostMessage]);

  useEffect(() => {
    let active = true;

    void (initialSession === undefined ? loadSession() : Promise.resolve(initialSession))
      .then(async (session) => {
        if (!active) return;
        if (!session) {
          setState({ status: "unpaired" });
          return;
        }

        sessionRef.current = session;

        const cached = loadCachedSnapshot(session.environmentId);
        snapshotCursorRef.current = cached?.cursor ?? 0;
        setState({
          status: "paired",
          session,
          snapshot: cached,
          liveEvents: [],
          diffs: {},
          connectionState: "connecting",
          isRefreshing: false,
        });
        socketRef.current?.connect(session, cached?.cursor);
        await refreshSnapshot(session, undefined, false);
      })
      .catch((error: unknown) => {
        if (active) setState({ status: "unpaired", error: messageFor(error) });
      });

    return () => {
      active = false;
    };
  }, [refreshSnapshot, initialSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const session = sessionRef.current;
      if (!session) return;
      if (nextState === "active") {
        socketRef.current?.connect(session, snapshotCursorRef.current || undefined);
      } else if (nextState === "background") {
        socketRef.current?.disconnect();
      }
    });
    return () => subscription.remove();
  }, [scheduleSnapshot]);

  const receivePairingLink = useCallback((url: string) => {
    try {
      parsePairingInput(url);
      setState((current) => {
        if (current.status === "paired") return current;
        return { status: "unpaired", pendingInput: url };
      });
    } catch {
      // Ignore unrelated app links. Manual input reports validation errors.
    }
  }, []);

  const pair = useCallback(
    async (rawInput: string) => {
      setState({ status: "pairing", pendingInput: rawInput });
      try {
        const pairing = parsePairingInput(rawInput);
        await gateway.health(pairing.host);

        const deviceId = await getDeviceIdentity();
        const session = await gateway.pair(pairing, {
          appVersion: Application.nativeApplicationVersion ?? "0.1.0",
          deviceId,
          deviceLabel: Device.deviceName ?? undefined,
        });
        await saveSession(session);
        sessionRef.current = session;
        snapshotCursorRef.current = 0;

        setState({
          status: "paired",
          session,
          snapshot: null,
          liveEvents: [],
          diffs: {},
          connectionState: "connecting",
          isRefreshing: true,
        });
        socketRef.current?.connect(session);
        await refreshSnapshot(session, undefined, false);
      } catch (error) {
        sessionRef.current = null;
        snapshotCursorRef.current = 0;
        setState({
          status: "unpaired",
          pendingInput: rawInput,
          error: messageFor(error),
        });
      }
    },
    [refreshSnapshot],
  );

  const refresh = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    socketRef.current?.connect(session, snapshotCursorRef.current || undefined);
    await refreshSnapshot(
      session,
      selectedThreadIdRef.current,
      connectionStateRef.current === "connected",
    );
  }, [refreshSnapshot]);

  const openThread = useCallback(
    async (threadId: string) => {
      selectedThreadIdRef.current = threadId;
      setState((current) =>
        current.status === "paired"
          ? {
              ...current,
              liveEvents: current.liveEvents.filter((event) => event.threadId === threadId),
            }
          : current,
      );
      const session = sessionRef.current;
      if (session) {
        const cached = loadCachedSnapshot(session.environmentId, threadId);
        setState((current) =>
          current.status === "paired" && cached
            ? {
                ...current,
                snapshot: current.snapshot
                  ? { ...current.snapshot, selectedTranscript: cached.selectedTranscript }
                  : cached,
              }
            : current,
        );
        if (connectionStateRef.current === "connected")
          await refreshSnapshot(session, threadId, true);
      }
    },
    [refreshSnapshot],
  );

  const closeThread = useCallback(() => {
    selectedThreadIdRef.current = undefined;
    if (connectionStateRef.current === "connected") scheduleSnapshot(true);
  }, [scheduleSnapshot]);

  const loadUsage = useCallback(async (threadId: string) => {
    const session = sessionRef.current;
    if (!session) throw new Error("Reconnect to view account usage.");
    const usage = await gateway.usage(session, threadId);
    if (sessionRef.current?.sessionId !== session.sessionId)
      throw new Error("The connection changed.");
    return usage;
  }, []);

  const requestModels = useCallback(async () => {
    const result = await runSocketCommand(
      socketRef.current,
      { type: "models.list" },
      "models.list.result",
    );
    return result.models;
  }, []);
  const modelCatalog = useModelCatalog(
    state.status === "paired" ? state.session.sessionId : undefined,
    requestModels,
  );
  const loadModels = modelCatalog.load;

  const loadComposerCommands = useCallback(async (threadId: string) => {
    const result = await runSocketCommand(
      socketRef.current,
      { type: "composer.commands", threadId },
      "composer.commands.result",
    );
    return result.commands;
  }, []);

  const loadDiff = useCallback(async (threadId: string, diffId = threadId) => {
    try {
      const result = await runSocketCommand(
        socketRef.current,
        { type: "diff.get", diffId },
        "diff.get.result",
      );
      updatePaired(setState, (current) => ({
        ...current,
        diffs: { ...current.diffs, [threadId]: result.diff },
      }));
    } catch {
      // No diff is a normal state, and older hosts may not support this read.
    }
  }, []);

  const loadDiffFile = useCallback(async (threadId: string, path: string) => {
    const sessionId = sessionRef.current?.sessionId;
    const result = await runSocketCommand(
      socketRef.current,
      { type: "diff.get", diffId: threadId, filePath: path },
      "diff.get.result",
    );
    if (sessionRef.current?.sessionId !== sessionId) return undefined;
    return result.diff;
  }, []);

  const setThreadModel = useCallback(
    async (threadId: string, model: GraftModelOption) => {
      try {
        const result = await runSocketCommand(
          socketRef.current,
          {
            type: "thread.set_model",
            threadId,
            modelId: model.id,
            providerId: model.providerId,
          },
          "thread.set_model.result",
        );
        updatePaired(setState, (current) => ({
          ...current,
          snapshot: withThread(current.snapshot, result.thread),
        }));
        scheduleSnapshot();
        return true;
      } catch (error) {
        setPairedError(setState, error);
        return false;
      }
    },
    [scheduleSnapshot],
  );

  const setThreadApproval = useCallback(
    async (threadId: string, approvalPolicy: string) => {
      try {
        const result = await runSocketCommand(
          socketRef.current,
          {
            type: "thread.set_approval",
            threadId,
            approvalPolicy,
          },
          "thread.set_approval.result",
        );
        updatePaired(setState, (current) => ({
          ...current,
          snapshot: withThread(current.snapshot, result.thread),
        }));
        scheduleSnapshot();
        return true;
      } catch (error) {
        setPairedError(setState, error);
        return false;
      }
    },
    [scheduleSnapshot],
  );

  const sendMessage = useCallback(
    async (
      threadId: string,
      rawText: string,
      effort?: string,
      options: ComposerSendOptions = {},
    ) => {
      const text = rawText.trim();
      const attachments = options.attachments ?? [];
      if (!text && attachments.length === 0) return false;
      const session = sessionRef.current;
      if (!session) return false;
      if (sendingThreadsRef.current.has(threadId)) return false;
      sendingThreadsRef.current.add(threadId);
      const attemptKey = JSON.stringify([
        session.sessionId,
        threadId,
        text,
        effort,
        options.interactionMode,
        options.fastMode,
        attachments,
      ]);
      const previousAttempt = sendAttemptsRef.current.get(threadId);
      const attempt: ComposerSendAttempt =
        previousAttempt?.key === attemptKey
          ? previousAttempt
          : { key: attemptKey, commandId: Crypto.randomUUID() };
      sendAttemptsRef.current.set(threadId, attempt);
      const optimisticId = Crypto.randomUUID();
      const optimisticEvent: GraftTimelineEvent = {
        id: optimisticId,
        cursor: 0,
        kind: "user.message",
        threadId,
        createdAt: Date.now(),
        text,
        ...(attachments.length ? { attachments: [...attachments] } : {}),
      };
      updatePaired(setState, (current) => {
        const transcript = current.snapshot?.selectedTranscript;
        const events = mergeTimelineEvents(
          transcript?.threadId === threadId ? transcript.events : [],
          current.liveEvents.filter((event) => event.threadId === threadId),
          transcript?.threadId === threadId ? transcript.cursor : 0,
        );
        const local: LocalTimelineEvent = {
          ...optimisticEvent,
          optimisticAfterMessageId:
            events.findLast((event) => event.kind === "user.message")?.id ??
            (transcript?.threadId === threadId ? null : undefined),
          optimisticAfterCursor: current.liveEvents.reduce(
            (cursor, event) => Math.max(cursor, event.cursor),
            current.snapshot?.cursor ?? 0,
          ),
        };
        return { ...current, liveEvents: [...current.liveEvents, local], error: undefined };
      });
      setPendingSendThreadId(threadId);

      try {
        const result = await sendWithAttachments(
          attachments,
          (attachment) => {
            if (sessionRef.current?.sessionId !== session.sessionId) {
              throw new GatewaySocketError("The paired session changed. Please send again.");
            }
            return gateway.uploadAttachment(
              session,
              threadId,
              attachment,
              new File(attachment.uri),
            );
          },
          (id) => gateway.cancelAttachment(session, id),
          (uploaded) => {
            if (sessionRef.current?.sessionId !== session.sessionId) {
              throw new GatewaySocketError("The paired session changed. Please send again.");
            }
            return runSocketCommand(
              socketRef.current,
              {
                type: "turn.start",
                threadId,
                text,
                ...(effort ? { effort } : {}),
                ...(uploaded.length ? { attachments: uploaded } : {}),
                ...(options.interactionMode ? { interactionMode: options.interactionMode } : {}),
                ...(options.fastMode !== undefined ? { fastMode: options.fastMode } : {}),
              },
              "turn.start.result",
              attempt.commandId,
            );
          },
          {
            attempt,
            isOutcomeUnknown: (error) =>
              error instanceof GatewaySocketError && error.outcomeUnknown,
          },
        );
        sendAttemptsRef.current.delete(threadId);
        updatePaired(setState, (current) =>
          current.session.sessionId === session.sessionId
            ? {
                ...current,
                snapshot: withRun(current.snapshot, result.run),
              }
            : current,
        );
        scheduleSnapshot();
        return true;
      } catch (error) {
        if (!attempt.uploaded) sendAttemptsRef.current.delete(threadId);
        updatePaired(setState, (current) =>
          current.session.sessionId === session.sessionId
            ? {
                ...current,
                liveEvents: current.liveEvents.filter((event) => event.id !== optimisticId),
                error: messageFor(error),
              }
            : current,
        );
        return false;
      } finally {
        sendingThreadsRef.current.delete(threadId);
        setPendingSendThreadId((current) => (current === threadId ? undefined : current));
      }
    },
    [scheduleSnapshot],
  );

  const cancelTurn = useCallback(
    async (runId: string) => {
      try {
        await requireSocket(socketRef.current).command({
          type: "turn.cancel",
          runId,
        });
        scheduleSnapshot();
        return true;
      } catch (error) {
        setPairedError(setState, error);
        return false;
      }
    },
    [scheduleSnapshot],
  );

  const createThread = useCallback(
    async (
      projectId: string,
      options: CreateThreadOptions = {},
    ): Promise<GraftThreadSummary | null> => {
      try {
        const result = await runSocketCommand(
          socketRef.current,
          {
            type: "thread.create",
            projectId,
            mode: options.mode,
            modelId: options.model?.id,
            providerId: options.model?.providerId,
            approvalPolicy: options.approvalPolicy,
          },
          "thread.create.result",
        );
        updatePaired(setState, (current) =>
          current.snapshot
            ? {
                ...current,
                snapshot: {
                  ...current.snapshot,
                  threads: [
                    result.thread,
                    ...current.snapshot.threads.filter((thread) => thread.id !== result.thread.id),
                  ],
                },
              }
            : current,
        );
        scheduleSnapshot();
        return result.thread;
      } catch (error) {
        setPairedError(setState, error);
        return null;
      }
    },
    [scheduleSnapshot],
  );

  const resolveApproval = useCallback(
    async (approvalId: string, decision: GraftApprovalDecision) => {
      try {
        await requireSocket(socketRef.current).command({
          type: "approval.resolve",
          approvalId,
          decision,
        });
        scheduleSnapshot();
        return true;
      } catch (error) {
        setPairedError(setState, error);
        return false;
      }
    },
    [scheduleSnapshot],
  );

  const resolveQuestion = useCallback(
    async (
      question: Pick<GraftQuestionRequest, "id">,
      answer: { readonly optionId?: string; readonly text?: string },
    ) => {
      try {
        await requireSocket(socketRef.current).command({
          type: "question.resolve",
          questionId: question.id,
          ...answer,
        });
        scheduleSnapshot();
        return true;
      } catch (error) {
        setPairedError(setState, error);
        return false;
      }
    },
    [scheduleSnapshot],
  );

  const unpair = useCallback(async () => {
    try {
      socketRef.current?.disconnect();
      const session = sessionRef.current;
      snapshotRequestRef.current += 1;
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      if (session) await clearSession(session.environmentId, session.sessionId);
      sessionRef.current = null;
      sendAttemptsRef.current.clear();
      snapshotCursorRef.current = 0;
      selectedThreadIdRef.current = undefined;
      setState({ status: "unpaired" });
    } catch (error) {
      setState((current) =>
        current.status === "paired" ? { ...current, error: messageFor(error) } : current,
      );
    }
  }, []);

  return {
    state,
    cancelTurn,
    closeThread,
    createThread,
    loadDiff,
    loadDiffFile,
    loadModels,
    modelCatalog,
    loadUsage,
    loadComposerCommands,
    openThread,
    pair,
    pendingSendThreadId,
    receivePairingLink,
    refresh,
    resolveApproval,
    resolveQuestion,
    sendMessage,
    setThreadApproval,
    setThreadModel,
    unpair,
  };
}
