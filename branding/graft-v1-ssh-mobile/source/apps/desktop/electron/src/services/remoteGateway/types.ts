import type {
  GraftApprovalDecision,
  GraftApprovalRequest,
  GraftDiffSummary,
  GraftMobileClientMessage,
  GraftModelOption,
  GraftPairExchangeRequest,
  GraftProjectSummary,
  GraftQuestionRequest,
  GraftRemoteEndpointKind,
  GraftRunSummary,
  GraftSessionCredential,
  GraftThreadSummary,
  GraftTranscriptSnapshot,
} from "@graft/shared";

export type RemoteGatewayConfig = {
  /** Bind host. Prefer Tailnet/LAN address over 0.0.0.0 when possible. */
  host: string;
  port: number;
  environmentId: string;
  environmentLabel: string;
  networkAccessEnabled: boolean;
  /** Registration-only APNs route scaffold; delivery is intentionally absent. */
  pushRegistrationEnabled?: boolean;
};

export type RemoteGatewayEndpoint = {
  kind: GraftRemoteEndpointKind;
  httpBaseUrl: string;
  wsBaseUrl: string;
};

export type IssuedPairingCredential = {
  token: string;
  expiresAt: number;
  pairingUrl: string;
  endpoint: RemoteGatewayEndpoint;
};

export type OpenThreadResult = {
  transcript: GraftTranscriptSnapshot;
  run: GraftRunSummary | null;
  pendingApprovals: GraftApprovalRequest[];
  pendingQuestions: GraftQuestionRequest[];
};

/**
 * Narrow ports the remote gateway uses to talk to desktop domain services.
 * Implemented by `createDesktopRemoteAdapters` and wired from `IpcController`.
 */
export type RemoteGatewayHandlers = {
  listProjects: () => Promise<GraftProjectSummary[]>;
  listThreads: (projectId?: string) => Promise<GraftThreadSummary[]>;
  openThread: (threadId: string) => Promise<OpenThreadResult>;
  createThread: (input: {
    projectId: string;
    title?: string;
    mode?: "local" | "worktree";
    modelId?: string;
    providerId?: string;
    approvalPolicy?: string;
  }) => Promise<GraftThreadSummary>;
  setThreadModel: (input: {
    threadId: string;
    modelId: string;
    providerId?: string;
  }) => Promise<GraftThreadSummary>;
  setThreadApproval: (input: {
    threadId: string;
    approvalPolicy: string;
  }) => Promise<GraftThreadSummary>;
  listModels: () => Promise<GraftModelOption[]>;
  startTurn: (input: {
    threadId: string;
    text: string;
    commandId: string;
    effort?: string;
  }) => Promise<{ runId: string }>;
  cancelTurn: (input: { runId: string; commandId: string }) => Promise<void>;
  steerTurn: (input: {
    runId: string;
    text: string;
    commandId: string;
  }) => Promise<{ runId: string }>;
  listActiveRuns: () => Promise<GraftRunSummary[]>;
  listPendingApprovals: (threadId?: string) => Promise<GraftApprovalRequest[]>;
  listPendingQuestions: (threadId?: string) => Promise<GraftQuestionRequest[]>;
  resolveApproval: (input: {
    approvalId: string;
    decision: GraftApprovalDecision;
  }) => Promise<void>;
  resolveQuestion: (input: {
    questionId: string;
    optionId?: string;
    text?: string;
  }) => Promise<void>;
  getDiff: (diffId: string) => Promise<GraftDiffSummary>;
};

export function createStubRemoteGatewayHandlers(
  overrides: Partial<RemoteGatewayHandlers> = {},
): RemoteGatewayHandlers {
  return {
    listProjects: async () => [],
    listThreads: async () => [],
    openThread: async (threadId) => ({
      transcript: {
        threadId,
        events: [],
        cursor: 0,
      },
      run: null,
      pendingApprovals: [],
      pendingQuestions: [],
    }),
    createThread: async ({
      projectId,
      title,
      mode,
      modelId,
      providerId,
      approvalPolicy,
    }) => ({
      id: `thread-${Date.now()}`,
      projectId,
      title: title ?? "New thread",
      updatedAt: Date.now(),
      status: "idle",
      mode: mode ?? "local",
      ...(modelId ? { modelName: modelId } : {}),
      ...(providerId ? { providerId } : {}),
      ...(approvalPolicy ? { approvalPolicy } : {}),
    }),
    setThreadModel: async ({ threadId, modelId, providerId }) => ({
      id: threadId,
      projectId: "project-stub",
      title: "New thread",
      updatedAt: Date.now(),
      status: "idle",
      modelName: modelId,
      ...(providerId ? { providerId } : {}),
    }),
    setThreadApproval: async ({ threadId, approvalPolicy }) => ({
      id: threadId,
      projectId: "project-stub",
      title: "New thread",
      updatedAt: Date.now(),
      status: "idle",
      approvalPolicy,
    }),
    listModels: async () => [],
    startTurn: async () => ({ runId: `run-${Date.now()}` }),
    cancelTurn: async () => undefined,
    steerTurn: async ({ runId }) => ({ runId }),
    listActiveRuns: async () => [],
    listPendingApprovals: async () => [],
    listPendingQuestions: async () => [],
    resolveApproval: async () => undefined,
    resolveQuestion: async () => undefined,
    getDiff: async (diffId) => ({
      id: diffId,
      threadId: "unknown",
      files: [],
      updatedAt: Date.now(),
    }),
    ...overrides,
  };
}

export type PairExchangeContext = {
  request: GraftPairExchangeRequest;
  session: GraftSessionCredential;
};

export type RemoteClientFrameHandler = {
  session: GraftSessionCredential;
  frame: GraftMobileClientMessage;
};
