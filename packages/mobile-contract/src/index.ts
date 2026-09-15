import { z } from "zod";

/**
 * Graft Mobile remote protocol (v1).
 *
 * Desktop (or headless host) owns projects, worktrees, providers, and execution.
 * Mobile is a disposable remote UI replica. Auth/pairing is separate from
 * transport (LAN, Tailscale, HTTPS, future relay).
 *
 * Invariants:
 * - Version negotiation via protocolVersion + capabilities
 * - Durable event ordering via monotonically increasing cursor
 * - Idempotent mutations via client-generated commandId
 * - Snapshots seed state; events incrementally update it
 * - Typed errors; bounded queues / snapshot_required on backpressure
 */

export const GRAFT_MOBILE_PROTOCOL_VERSION = 1 as const;
export const GRAFT_ATTACHMENT_UPLOAD_PATH = "/v1/attachments/upload" as const;
export const GRAFT_ATTACHMENT_CANCEL_PATH = "/v1/attachments/cancel" as const;

export const GRAFT_MOBILE_CAPABILITIES = [
  "projects",
  "threads",
  "transcript",
  "runs",
  "approvals",
  "diffs",
  "cursor_replay",
  "models",
  "transcript_rich",
] as const;
export type GraftMobileCapability = (typeof GRAFT_MOBILE_CAPABILITIES)[number];
export const GraftMobileCapabilitySchema = z.enum(GRAFT_MOBILE_CAPABILITIES);

export const GraftRemoteEndpointKindSchema = z.enum([
  "loopback",
  "lan",
  "tailnet",
  "https",
  "relay",
]);
export type GraftRemoteEndpointKind = z.infer<typeof GraftRemoteEndpointKindSchema>;

/** Monotonically increasing event cursor within one environment. */
export const GraftRemoteCursorSchema = z.number().int().nonnegative();
export type GraftRemoteCursor = z.infer<typeof GraftRemoteCursorSchema>;

export const GraftCommandIdSchema = z.string().uuid();
export type GraftCommandId = z.infer<typeof GraftCommandIdSchema>;

export const GraftRequestIdSchema = z.string().min(1).max(128);
export type GraftRequestId = z.infer<typeof GraftRequestIdSchema>;

export const GraftPairingTokenSchema = z
  .string()
  .min(16)
  .max(256)
  .regex(/^[A-Za-z0-9._~-]+$/);
export type GraftPairingToken = z.infer<typeof GraftPairingTokenSchema>;

export const GraftPairingHostSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Pairing hosts must use HTTP or HTTPS");

export const GraftApnsDeviceTokenSchema = z
  .string()
  .min(2)
  .max(512)
  .regex(/^(?:[0-9a-f]{2})+$/);
export type GraftApnsDeviceToken = z.infer<typeof GraftApnsDeviceTokenSchema>;

export const GraftApnsEnvironmentSchema = z.enum(["sandbox", "production"]);
export type GraftApnsEnvironment = z.infer<typeof GraftApnsEnvironmentSchema>;

export const GraftPushRegistrationRequestSchema = z
  .object({
    apnsToken: GraftApnsDeviceTokenSchema,
    apnsEnvironment: GraftApnsEnvironmentSchema,
    bundleId: z.string().min(1).max(256),
  })
  .strict();
export type GraftPushRegistrationRequest = z.infer<typeof GraftPushRegistrationRequestSchema>;

export const GraftPushUnregistrationRequestSchema = z.object({}).strict();
export type GraftPushUnregistrationRequest = z.infer<typeof GraftPushUnregistrationRequestSchema>;

export const GraftPushRegistrationMetadataSchema = z.object({
  deviceId: z.string().min(1).max(256),
  apnsEnvironment: GraftApnsEnvironmentSchema,
  bundleId: z.string().min(1).max(256),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type GraftPushRegistrationMetadata = z.infer<typeof GraftPushRegistrationMetadataSchema>;

export const GraftPushRegistrationResponseSchema = z.object({
  ok: z.literal(true),
  registration: GraftPushRegistrationMetadataSchema,
});
export type GraftPushRegistrationResponse = z.infer<typeof GraftPushRegistrationResponseSchema>;

export const GraftPushUnregistrationResponseSchema = z.object({
  ok: z.literal(true),
  removed: z.boolean(),
});
export type GraftPushUnregistrationResponse = z.infer<typeof GraftPushUnregistrationResponseSchema>;

// ---------------------------------------------------------------------------
// Domain summaries
// ---------------------------------------------------------------------------

export const GraftInteractionModeSchema = z.enum(["default", "plan", "debug"]);
export type GraftInteractionMode = z.infer<typeof GraftInteractionModeSchema>;

export const GRAFT_MOBILE_MAX_ATTACHMENTS = 8;
export const GRAFT_MOBILE_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const GRAFT_MOBILE_MAX_FILE_BYTES = 25 * 1024 * 1024;

const attachmentFields = {
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(100),
};
export const GraftAttachmentSchema = z.discriminatedUnion("type", [
  z.object({
    ...attachmentFields,
    type: z.literal("image"),
    mimeType: attachmentFields.mimeType.regex(/^image\//i),
    sizeBytes: z.number().int().nonnegative().max(GRAFT_MOBILE_MAX_IMAGE_BYTES),
  }),
  z.object({
    ...attachmentFields,
    type: z.literal("file"),
    sizeBytes: z.number().int().nonnegative().max(GRAFT_MOBILE_MAX_FILE_BYTES),
  }),
]);
export type GraftAttachment = z.infer<typeof GraftAttachmentSchema>;

export const GraftEnvironmentSummarySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(120),
  hostVersion: z.string().min(1).optional(),
  protocolVersion: z.literal(GRAFT_MOBILE_PROTOCOL_VERSION),
  capabilities: z.array(GraftMobileCapabilitySchema).min(1),
  /** Additive feature flags: older clients ignore them, older hosts omit them. */
  composerFeatures: z
    .object({
      attachments: z.boolean(),
      interactionModes: z.boolean(),
      fastMode: z.boolean(),
    })
    .optional(),
  cursor: GraftRemoteCursorSchema,
});
export type GraftEnvironmentSummary = z.infer<typeof GraftEnvironmentSummarySchema>;

export const GraftProjectSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["repo", "desktop"]),
  path: z.string().min(1).optional(),
  updatedAt: z.number().int().nonnegative().optional(),
});
export type GraftProjectSummary = z.infer<typeof GraftProjectSummarySchema>;

export const GraftThreadStatusSchema = z.enum(["idle", "running", "needs_attention"]);
export type GraftThreadStatus = z.infer<typeof GraftThreadStatusSchema>;

export const GraftThreadModeSchema = z.enum(["local", "worktree"]);
export type GraftThreadMode = z.infer<typeof GraftThreadModeSchema>;

/** GitHub state of the PR a thread tracks, for the mobile inbox glyphs. */
export const GraftThreadPrStateSchema = z.enum([
  "open",
  "draft",
  "changes_requested",
  "merged",
  "closed",
]);
export type GraftThreadPrState = z.infer<typeof GraftThreadPrStateSchema>;

export const GraftThreadPrSchema = z.object({
  number: z.number().int().positive(),
  state: GraftThreadPrStateSchema,
  url: z.string().min(1).optional(),
});
export type GraftThreadPr = z.infer<typeof GraftThreadPrSchema>;

/** One selectable approval policy for a thread's provider. */
export const GraftApprovalPolicyOptionSchema = z.object({
  value: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  description: z.string().min(1).max(160).optional(),
});
export type GraftApprovalPolicyOption = z.infer<typeof GraftApprovalPolicyOptionSchema>;

/** Measured occupancy of a thread's current model context window. */
export const GraftContextUsageSchema = z.object({
  percent: z.number().int().min(0).max(100),
  tokensUsed: z.number().int().nonnegative(),
  tokensMax: z.number().int().nonnegative(),
  source: z.enum(["measured", "unknown"]),
});
export type GraftContextUsage = z.infer<typeof GraftContextUsageSchema>;

/** Account limits are separate from the current thread's context occupancy. */
export const GraftProviderAllowanceSchema = z.object({
  providerId: z.string().min(1),
  status: z.enum(["ok", "needs-auth", "unsupported", "error"]),
  updatedAt: z.string().optional(),
  stale: z.boolean(),
  planName: z.string().optional(),
  limits: z.array(
    z.object({
      label: z.string(),
      remainingPercent: z.number().min(0).max(100),
      resetsAt: z.string().optional(),
    }),
  ),
});
export type GraftProviderAllowance = z.infer<typeof GraftProviderAllowanceSchema>;

export const GraftThreadUsageSchema = z.object({
  threadId: z.string().min(1),
  contextUsage: GraftContextUsageSchema.optional(),
  allowance: GraftProviderAllowanceSchema,
});
export type GraftThreadUsage = z.infer<typeof GraftThreadUsageSchema>;

export const GraftThreadSummarySchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  updatedAt: z.number().int().nonnegative(),
  status: GraftThreadStatusSchema.optional(),
  preview: z.string().max(280).optional(),
  modelName: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  /** True once conversation activity binds this thread to its provider. */
  providerLocked: z.boolean().optional(),
  interactionMode: GraftInteractionModeSchema.optional(),
  fastMode: z.boolean().optional(),
  /** Workspace selected when the thread was created. */
  mode: GraftThreadModeSchema.optional(),
  /** Current approval policy, resolved against the provider's defaults. */
  approvalPolicy: z.string().min(1).max(40).optional(),
  /** Policies the mobile picker can offer for this thread's provider. */
  approvalPolicyOptions: z.array(GraftApprovalPolicyOptionSchema).max(12).optional(),
  /** The PR this thread tracks, when its GitHub state is known. */
  pr: GraftThreadPrSchema.optional(),
  /** Latest context-window occupancy resolved by the host. */
  contextUsage: GraftContextUsageSchema.optional(),
});
export type GraftThreadSummary = z.infer<typeof GraftThreadSummarySchema>;

/** A model the host can run turns with, offered to the mobile picker. */
export const GraftModelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  providerId: z.string().min(1),
  providerLabel: z.string().min(1).optional(),
  isDefault: z.boolean().optional(),
  supportsFastMode: z.boolean().optional(),
  /**
   * Selectable reasoning efforts for this model, in display order. Omitted
   * when the model has no effort choice.
   */
  reasoningEfforts: z.array(z.string().min(1).max(40)).max(12).optional(),
  /** Provider-defined policies available before a new thread exists. */
  approvalPolicyOptions: z.array(GraftApprovalPolicyOptionSchema).max(12).optional(),
  /** Safe provider default for a newly-created thread. */
  defaultApprovalPolicy: z.string().min(1).max(40).optional(),
});
export type GraftModelOption = z.infer<typeof GraftModelOptionSchema>;

export const GraftRunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);
export type GraftRunStatus = z.infer<typeof GraftRunStatusSchema>;

export const GraftRunSummarySchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  status: GraftRunStatusSchema,
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().nullable().optional(),
  title: z.string().max(200).optional(),
});
export type GraftRunSummary = z.infer<typeof GraftRunSummarySchema>;

export const GraftTimelineEventKindSchema = z.enum([
  "user.message",
  "assistant.message",
  "assistant.delta",
  "thinking.delta",
  "tool.start",
  "tool.update",
  "tool.end",
  "run.status",
  "approval.requested",
  "approval.resolved",
  "question.requested",
  "question.resolved",
  "diff.updated",
  "error",
  "file.edit",
  "shell.command",
  "plan.update",
  "todo.update",
  "web.search",
  "subagent.update",
  "artifact",
  "image",
  "status",
]);
export type GraftTimelineEventKind = z.infer<typeof GraftTimelineEventKindSchema>;

export const GraftTimelineQuestionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type GraftTimelineQuestionOption = z.infer<typeof GraftTimelineQuestionOptionSchema>;

/**
 * Structured payload for rich timeline events ("transcript_rich" capability).
 *
 * Events with a structured kind always populate `text` with a human-readable
 * fallback so text-only consumers stay coherent; `data` carries the typed
 * payload. Unknown `data.type` values must be tolerated by clients (decode to
 * nil/undefined, never fail the event).
 */
export const GraftTimelineEventDataSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file_edit"),
    filePath: z.string().min(1),
    diff: z.string().max(100_000),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    truncated: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("shell_command"),
    command: z.string().max(10_000),
    exitCode: z.number().int().nullable().optional(),
    cwd: z.string().optional(),
    output: z.string().max(100_000).optional(),
    truncated: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("plan"),
    title: z.string().optional(),
    steps: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          status: z.enum(["pending", "active", "done"]),
        }),
      )
      .max(100),
  }),
  z.object({
    type: z.literal("todo_update"),
    todos: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
          status: z.enum(["pending", "in_progress", "completed"]),
        }),
      )
      .max(100),
  }),
  z.object({
    type: z.literal("web_search"),
    query: z.string(),
    results: z
      .array(
        z.object({
          title: z.string(),
          url: z.string(),
          snippet: z.string().optional(),
        }),
      )
      .max(20)
      .optional(),
  }),
  z.object({
    type: z.literal("sub_agent"),
    agentId: z.string().min(1),
    name: z.string().optional(),
    status: z.enum(["running", "done", "failed"]),
    summary: z.string().optional(),
  }),
  z.object({
    type: z.literal("artifact"),
    artifactId: z.string().min(1),
    title: z.string().optional(),
    mimeType: z.string().optional(),
    preview: z.string().max(20_000).optional(),
  }),
  z.object({
    type: z.literal("image"),
    path: z.string().optional(),
    /** Base64-encoded thumbnail, ~128 KB binary max. */
    base64Thumbnail: z.string().max(180_000).optional(),
    alt: z.string().optional(),
  }),
  z.object({
    type: z.literal("question"),
    questions: z
      .array(
        z.object({
          id: z.string().min(1),
          prompt: z.string(),
          options: z.array(GraftTimelineQuestionOptionSchema),
          allowsText: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(10),
  }),
  z.object({
    type: z.literal("permission"),
    title: z.string(),
    detail: z.string().optional(),
    toolName: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool"),
    toolName: z.string(),
    inputPreview: z.string().max(10_000).optional(),
    resultPreview: z.string().max(20_000).optional(),
  }),
]);
export type GraftTimelineEventData = z.infer<typeof GraftTimelineEventDataSchema>;

export const GraftTimelineEventSchema = z.object({
  id: z.string().min(1),
  cursor: GraftRemoteCursorSchema,
  kind: GraftTimelineEventKindSchema,
  threadId: z.string().min(1),
  runId: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
  text: z.string().optional(),
  toolName: z.string().optional(),
  approvalId: z.string().min(1).optional(),
  questionId: z.string().min(1).optional(),
  diffId: z.string().min(1).optional(),
  runStatus: GraftRunStatusSchema.optional(),
  data: GraftTimelineEventDataSchema.optional(),
  attachments: z.array(GraftAttachmentSchema).max(GRAFT_MOBILE_MAX_ATTACHMENTS).optional(),
});
export type GraftTimelineEvent = z.infer<typeof GraftTimelineEventSchema>;

export const GraftApprovalDecisionSchema = z.enum(["allow_once", "allow_session", "deny"]);
export type GraftApprovalDecision = z.infer<typeof GraftApprovalDecisionSchema>;

export const GraftApprovalRequestSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  runId: z.string().min(1).optional(),
  title: z.string().min(1),
  detail: z.string().optional(),
  toolName: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
});
export type GraftApprovalRequest = z.infer<typeof GraftApprovalRequestSchema>;

export const GraftQuestionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type GraftQuestionOption = z.infer<typeof GraftQuestionOptionSchema>;

export const GraftQuestionRequestSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  runId: z.string().min(1).optional(),
  prompt: z.string().min(1),
  options: z.array(GraftQuestionOptionSchema).optional(),
  allowFreeform: z.boolean().optional(),
  createdAt: z.number().int().nonnegative(),
});
export type GraftQuestionRequest = z.infer<typeof GraftQuestionRequestSchema>;

export const GraftDiffTokenSchema = z.object({
  text: z.string(),
  lightColor: z.string().optional(),
  darkColor: z.string().optional(),
  changed: z.boolean().optional(),
});
export const GraftDiffLineSchema = z.object({
  kind: z.enum(["context", "addition", "deletion"]),
  text: z.string(),
  oldLine: z.number().int().positive().optional(),
  newLine: z.number().int().positive().optional(),
  tokens: z.array(GraftDiffTokenSchema).optional(),
});
export type GraftDiffLine = z.infer<typeof GraftDiffLineSchema>;
export const GraftDiffHunkSchema = z.object({
  oldStart: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  collapsedBefore: z.number().int().nonnegative(),
  lines: z.array(GraftDiffLineSchema),
});
export type GraftDiffHunk = z.infer<typeof GraftDiffHunkSchema>;

export const GraftDiffFileSummarySchema = z.object({
  path: z.string().min(1),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  previousPath: z.string().optional(),
  hunks: z.array(GraftDiffHunkSchema).optional(),
  detailStatus: z.enum(["ready", "binary", "unavailable", "truncated"]).optional(),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
});
export type GraftDiffFileSummary = z.infer<typeof GraftDiffFileSummarySchema>;

export const GraftDiffSummarySchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  runId: z.string().min(1).optional(),
  title: z.string().optional(),
  files: z.array(GraftDiffFileSummarySchema),
  updatedAt: z.number().int().nonnegative(),
});
export type GraftDiffSummary = z.infer<typeof GraftDiffSummarySchema>;

export const GraftTranscriptSnapshotSchema = z.object({
  threadId: z.string().min(1),
  events: z.array(GraftTimelineEventSchema),
  cursor: GraftRemoteCursorSchema,
});
export type GraftTranscriptSnapshot = z.infer<typeof GraftTranscriptSnapshotSchema>;

export const GraftCommandReceiptStatusSchema = z.enum([
  "accepted",
  "duplicate",
  "rejected",
  "completed",
]);
export type GraftCommandReceiptStatus = z.infer<typeof GraftCommandReceiptStatusSchema>;

export const GraftCommandReceiptSchema = z.object({
  commandId: GraftCommandIdSchema,
  status: GraftCommandReceiptStatusSchema,
  requestId: GraftRequestIdSchema.optional(),
  runId: z.string().min(1).optional(),
  errorCode: z.string().min(1).optional(),
  message: z.string().optional(),
  cursor: GraftRemoteCursorSchema.optional(),
});
export type GraftCommandReceipt = z.infer<typeof GraftCommandReceiptSchema>;

export const GraftCursorReplaySchema = z.object({
  afterCursor: GraftRemoteCursorSchema,
  events: z.array(GraftTimelineEventSchema),
  latestCursor: GraftRemoteCursorSchema,
  snapshotRequired: z.boolean().optional(),
});
export type GraftCursorReplay = z.infer<typeof GraftCursorReplaySchema>;

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export const GraftRemoteErrorCodeSchema = z.enum([
  "authentication_required",
  "authorization_denied",
  "device_revoked",
  "pairing_token_invalid",
  "pairing_token_expired",
  "pairing_token_replayed",
  "protocol_unsupported",
  "capability_unsupported",
  "validation_failed",
  "stale_revision",
  "snapshot_required",
  "host_offline",
  "overload",
  "backpressure",
  "not_found",
  "conflict",
  "internal",
]);
export type GraftRemoteErrorCode = z.infer<typeof GraftRemoteErrorCodeSchema>;

export const GraftRemoteErrorSchema = z.object({
  code: GraftRemoteErrorCodeSchema,
  message: z.string().min(1),
  requestId: GraftRequestIdSchema.optional(),
  commandId: GraftCommandIdSchema.optional(),
  retryable: z.boolean().optional(),
});
export type GraftRemoteError = z.infer<typeof GraftRemoteErrorSchema>;

// ---------------------------------------------------------------------------
// Pairing + session
// ---------------------------------------------------------------------------

/** One-time pairing payload encoded in QR / deep link. */
export const GraftPairingPayloadSchema = z.object({
  v: z.literal(GRAFT_MOBILE_PROTOCOL_VERSION),
  host: GraftPairingHostSchema,
  token: GraftPairingTokenSchema,
  label: z.string().min(1).max(120).optional(),
  endpointKind: GraftRemoteEndpointKindSchema.optional(),
});
export type GraftPairingPayload = z.infer<typeof GraftPairingPayloadSchema>;

export const GraftSessionCredentialSchema = z.object({
  sessionId: z.string().min(1),
  deviceId: z.string().min(1),
  bearerToken: z.string().min(16),
  environmentId: z.string().min(1),
  environmentLabel: z.string().min(1),
  httpBaseUrl: z.string().url(),
  wsBaseUrl: z.string().url(),
  protocolVersion: z.literal(GRAFT_MOBILE_PROTOCOL_VERSION),
  capabilities: z.array(GraftMobileCapabilitySchema).min(1),
  expiresAt: z.number().int().positive().nullable(),
  /**
   * Transport the session was issued over. Additive and optional so sessions
   * persisted before managed relay existed still parse.
   */
  endpointKind: GraftRemoteEndpointKindSchema.optional(),
});
export type GraftSessionCredential = z.infer<typeof GraftSessionCredentialSchema>;

export const GraftPairExchangeRequestSchema = z.object({
  token: GraftPairingTokenSchema,
  protocolVersion: z.literal(GRAFT_MOBILE_PROTOCOL_VERSION),
  client: z.object({
    platform: z.enum(["ios", "android", "web", "desktop"]),
    appVersion: z.string().min(1),
    deviceLabel: z.string().min(1).max(120).optional(),
    /**
     * Stable, client-generated identity for the physical device. Re-pairing
     * with the same identity replaces the prior registration instead of
     * accumulating a new device row per exchange.
     */
    deviceId: z.string().min(8).max(128).optional(),
  }),
});
export type GraftPairExchangeRequest = z.infer<typeof GraftPairExchangeRequestSchema>;

export const GraftPairExchangeResponseSchema = z.object({
  ok: z.literal(true),
  session: GraftSessionCredentialSchema,
});
export type GraftPairExchangeResponse = z.infer<typeof GraftPairExchangeResponseSchema>;

export const GraftPairExchangeErrorSchema = z.object({
  ok: z.literal(false),
  error: GraftRemoteErrorSchema,
});
export type GraftPairExchangeError = z.infer<typeof GraftPairExchangeErrorSchema>;

// ---------------------------------------------------------------------------
// HTTP: health + snapshot
// ---------------------------------------------------------------------------

export const GraftRemoteHealthSchema = z.object({
  ok: z.literal(true),
  service: z.literal("graft-remote-gateway"),
  protocolVersion: z.literal(GRAFT_MOBILE_PROTOCOL_VERSION),
  capabilities: z.array(GraftMobileCapabilitySchema).min(1),
  environmentId: z.string().min(1),
  environmentLabel: z.string().min(1),
  networkAccessEnabled: z.boolean(),
  cursor: GraftRemoteCursorSchema.optional(),
});
export type GraftRemoteHealth = z.infer<typeof GraftRemoteHealthSchema>;

export const GraftEnvironmentSnapshotSchema = z.object({
  environment: GraftEnvironmentSummarySchema,
  projects: z.array(GraftProjectSummarySchema),
  threads: z.array(GraftThreadSummarySchema),
  activeRuns: z.array(GraftRunSummarySchema),
  pendingApprovals: z.array(GraftApprovalRequestSchema),
  pendingQuestions: z.array(GraftQuestionRequestSchema),
  selectedTranscript: GraftTranscriptSnapshotSchema.nullable(),
  cursor: GraftRemoteCursorSchema,
});
export type GraftEnvironmentSnapshot = z.infer<typeof GraftEnvironmentSnapshotSchema>;

export const GraftSnapshotQuerySchema = z.object({
  threadId: z.string().min(1).optional(),
  afterCursor: GraftRemoteCursorSchema.optional(),
});
export type GraftSnapshotQuery = z.infer<typeof GraftSnapshotQuerySchema>;

// ---------------------------------------------------------------------------
// Commands (client → host mutations / reads)
// ---------------------------------------------------------------------------

export const GraftMobileCommandSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("project.list"),
    }),
    z.object({
      type: z.literal("thread.list"),
      projectId: z.string().min(1).optional(),
      query: z.string().max(200).optional(),
    }),
    z.object({
      type: z.literal("thread.open"),
      threadId: z.string().min(1),
    }),
    z.object({
      type: z.literal("thread.create"),
      projectId: z.string().min(1),
      title: z.string().min(1).max(200).optional(),
      mode: GraftThreadModeSchema.optional(),
      modelId: z.string().min(1).optional(),
      providerId: z.string().min(1).optional(),
      approvalPolicy: z.string().min(1).max(40).optional(),
    }),
    z.object({
      type: z.literal("thread.set_model"),
      threadId: z.string().min(1),
      modelId: z.string().min(1),
      providerId: z.string().min(1).optional(),
    }),
    z.object({
      type: z.literal("thread.set_approval"),
      threadId: z.string().min(1),
      approvalPolicy: z.string().min(1).max(40),
    }),
    z.object({
      type: z.literal("models.list"),
    }),
    z.object({
      type: z.literal("turn.start"),
      threadId: z.string().min(1),
      text: z.string().max(100_000),
      attachments: z.array(GraftAttachmentSchema).max(GRAFT_MOBILE_MAX_ATTACHMENTS).optional(),
      interactionMode: GraftInteractionModeSchema.optional(),
      fastMode: z.boolean().optional(),
      /** Reasoning effort for this turn; host default when omitted. */
      effort: z.string().min(1).max(40).optional(),
    }),
    z.object({
      type: z.literal("turn.cancel"),
      runId: z.string().min(1),
    }),
    z.object({
      type: z.literal("turn.steer"),
      runId: z.string().min(1),
      text: z.string().min(1).max(100_000),
    }),
    z.object({
      type: z.literal("approval.resolve"),
      approvalId: z.string().min(1),
      decision: GraftApprovalDecisionSchema,
    }),
    z.object({
      type: z.literal("question.resolve"),
      questionId: z.string().min(1),
      optionId: z.string().min(1).optional(),
      text: z.string().max(10_000).optional(),
    }),
    z.object({
      type: z.literal("diff.get"),
      diffId: z.string().min(1),
      filePath: z.string().min(1).optional(),
    }),
    z.object({
      type: z.literal("cursor.replay"),
      afterCursor: GraftRemoteCursorSchema,
    }),
    z.object({
      type: z.literal("snapshot.get"),
      threadId: z.string().min(1).optional(),
    }),
  ])
  .refine(
    (command) =>
      command.type !== "turn.start" || Boolean(command.text.trim() || command.attachments?.length),
    { message: "A message or attachment is required." },
  );
export type GraftMobileCommand = z.infer<typeof GraftMobileCommandSchema>;

export const GraftMobileCommandResultSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("project.list.result"),
    projects: z.array(GraftProjectSummarySchema),
  }),
  z.object({
    type: z.literal("thread.list.result"),
    threads: z.array(GraftThreadSummarySchema),
  }),
  z.object({
    type: z.literal("thread.open.result"),
    transcript: GraftTranscriptSnapshotSchema,
    run: GraftRunSummarySchema.nullable(),
    pendingApprovals: z.array(GraftApprovalRequestSchema),
    pendingQuestions: z.array(GraftQuestionRequestSchema),
  }),
  z.object({
    type: z.literal("thread.create.result"),
    thread: GraftThreadSummarySchema,
  }),
  z.object({
    type: z.literal("thread.set_model.result"),
    thread: GraftThreadSummarySchema,
  }),
  z.object({
    type: z.literal("thread.set_approval.result"),
    thread: GraftThreadSummarySchema,
  }),
  z.object({
    type: z.literal("models.list.result"),
    models: z.array(GraftModelOptionSchema),
  }),
  z.object({
    type: z.literal("turn.start.result"),
    run: GraftRunSummarySchema,
  }),
  z.object({
    type: z.literal("turn.cancel.result"),
    runId: z.string().min(1),
  }),
  z.object({
    type: z.literal("turn.steer.result"),
    runId: z.string().min(1),
  }),
  z.object({
    type: z.literal("approval.resolve.result"),
    approvalId: z.string().min(1),
    decision: GraftApprovalDecisionSchema,
  }),
  z.object({
    type: z.literal("question.resolve.result"),
    questionId: z.string().min(1),
  }),
  z.object({
    type: z.literal("diff.get.result"),
    diff: GraftDiffSummarySchema,
  }),
  z.object({
    type: z.literal("cursor.replay.result"),
    replay: GraftCursorReplaySchema,
  }),
  z.object({
    type: z.literal("snapshot.get.result"),
    snapshot: GraftEnvironmentSnapshotSchema,
  }),
]);
export type GraftMobileCommandResult = z.infer<typeof GraftMobileCommandResultSchema>;

// ---------------------------------------------------------------------------
// WebSocket envelopes
// ---------------------------------------------------------------------------

export const GraftMobileClientMessageSchema = z.discriminatedUnion("envelope", [
  z.object({
    envelope: z.literal("hello"),
    protocolVersion: z.literal(GRAFT_MOBILE_PROTOCOL_VERSION),
    sessionId: z.string().min(1),
    afterCursor: GraftRemoteCursorSchema.optional(),
    capabilities: z.array(GraftMobileCapabilitySchema).optional(),
  }),
  z.object({
    envelope: z.literal("ping"),
    at: z.number().int().nonnegative(),
  }),
  z.object({
    envelope: z.literal("subscribe"),
    topics: z.array(z.enum(["projects", "threads", "runs", "events", "approvals"])).min(1),
    afterCursor: GraftRemoteCursorSchema.optional(),
  }),
  z.object({
    envelope: z.literal("command"),
    commandId: GraftCommandIdSchema,
    requestId: GraftRequestIdSchema.optional(),
    command: GraftMobileCommandSchema,
  }),
]);
export type GraftMobileClientMessage = z.infer<typeof GraftMobileClientMessageSchema>;

export const GraftMobileHostMessageSchema = z.discriminatedUnion("envelope", [
  z.object({
    envelope: z.literal("welcome"),
    protocolVersion: z.literal(GRAFT_MOBILE_PROTOCOL_VERSION),
    capabilities: z.array(GraftMobileCapabilitySchema).min(1),
    environmentId: z.string().min(1),
    environmentLabel: z.string().min(1),
    cursor: GraftRemoteCursorSchema,
  }),
  z.object({
    envelope: z.literal("pong"),
    at: z.number().int().nonnegative(),
  }),
  z.object({
    envelope: z.literal("response"),
    commandId: GraftCommandIdSchema,
    requestId: GraftRequestIdSchema.optional(),
    receipt: GraftCommandReceiptSchema,
    result: GraftMobileCommandResultSchema.optional(),
  }),
  z.object({
    envelope: z.literal("event"),
    event: GraftTimelineEventSchema,
  }),
  z.object({
    envelope: z.literal("error"),
    error: GraftRemoteErrorSchema,
  }),
  z.object({
    envelope: z.literal("snapshot_required"),
    reason: z.enum(["cursor_expired", "backpressure", "schema_changed", "resync"]),
    message: z.string().min(1).optional(),
  }),
]);
export type GraftMobileHostMessage = z.infer<typeof GraftMobileHostMessageSchema>;

/** @deprecated Prefer GraftMobileClientMessage — kept for transitional adapters. */
export type GraftRemoteClientFrame = GraftMobileClientMessage;
/** @deprecated Prefer GraftMobileHostMessage — kept for transitional adapters. */
export type GraftRemoteHostFrame = GraftMobileHostMessage;
export const GraftRemoteClientFrameSchema = GraftMobileClientMessageSchema;
export const GraftRemoteHostFrameSchema = GraftMobileHostMessageSchema;

// ---------------------------------------------------------------------------
// Exhaustiveness helpers
// ---------------------------------------------------------------------------

export function assertNeverMobile(value: never): never {
  throw new Error(`Unhandled mobile protocol variant: ${JSON.stringify(value)}`);
}

export function describeMobileCommand(command: GraftMobileCommand): string {
  switch (command.type) {
    case "project.list":
      return "project.list";
    case "thread.list":
      return "thread.list";
    case "thread.open":
      return "thread.open";
    case "thread.create":
      return "thread.create";
    case "thread.set_model":
      return "thread.set_model";
    case "thread.set_approval":
      return "thread.set_approval";
    case "models.list":
      return "models.list";
    case "turn.start":
      return "turn.start";
    case "turn.cancel":
      return "turn.cancel";
    case "turn.steer":
      return "turn.steer";
    case "approval.resolve":
      return "approval.resolve";
    case "question.resolve":
      return "question.resolve";
    case "diff.get":
      return "diff.get";
    case "cursor.replay":
      return "cursor.replay";
    case "snapshot.get":
      return "snapshot.get";
    default: {
      const _exhaustive: never = command;
      return assertNeverMobile(_exhaustive);
    }
  }
}

export function describeMobileHostMessage(message: GraftMobileHostMessage): string {
  switch (message.envelope) {
    case "welcome":
      return "welcome";
    case "pong":
      return "pong";
    case "response":
      return "response";
    case "event":
      return "event";
    case "error":
      return "error";
    case "snapshot_required":
      return "snapshot_required";
    default: {
      const _exhaustive: never = message;
      return assertNeverMobile(_exhaustive);
    }
  }
}

// ---------------------------------------------------------------------------
// Pairing URL helpers
// ---------------------------------------------------------------------------

const PAIRING_SCHEME = "graft";

/** Build a deep-link / QR pairing URL from a host endpoint + one-time token. */
export function buildGraftPairingUrl(payload: GraftPairingPayload): string {
  const validated = GraftPairingPayloadSchema.parse(payload);
  const url = new URL(`${PAIRING_SCHEME}://pair`);
  url.searchParams.set("v", String(validated.v));
  url.searchParams.set("host", validated.host);
  if (validated.label) url.searchParams.set("label", validated.label);
  if (validated.endpointKind) {
    url.searchParams.set("endpointKind", validated.endpointKind);
  }
  // Keep the one-time token in the fragment so intermediaries that log the
  // query string do not automatically capture the credential (T3 pattern).
  url.hash = `token=${encodeURIComponent(validated.token)}`;
  return url.toString();
}

/** Parse a Graft pairing deep link or https://…/pair?host=…#token=… URL. */
export function parseGraftPairingUrl(raw: string): GraftPairingPayload | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const isGraftPairingLink =
    url.protocol === `${PAIRING_SCHEME}:` &&
    url.hostname === "pair" &&
    (url.pathname === "" || url.pathname === "/");
  const isHttpsPairingLink =
    url.protocol === "https:" && url.pathname.replace(/\/+$/, "") === "/pair";
  if (!isGraftPairingLink && !isHttpsPairingLink) return null;

  const host = url.searchParams.get("host");
  const tokenFromHash = new URLSearchParams(url.hash.replace(/^#/, "")).get("token");
  if (!host || !tokenFromHash || url.searchParams.has("token")) return null;

  const versionRaw = url.searchParams.get("v");
  if (versionRaw !== String(GRAFT_MOBILE_PROTOCOL_VERSION)) return null;

  const parsed = GraftPairingPayloadSchema.safeParse({
    v: GRAFT_MOBILE_PROTOCOL_VERSION,
    host,
    token: tokenFromHash,
    label: url.searchParams.get("label") ?? undefined,
    endpointKind: url.searchParams.get("endpointKind") ?? undefined,
  });
  return parsed.success ? parsed.data : null;
}

export function toWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  // Normalize trailing slash so clients can append `/v1/ws` consistently.
  // URL#toString() reintroduces "/" for an empty pathname, so build manually.
  const path = url.pathname.replace(/\/+$/, "");
  return `${protocol}//${url.host}${path}`;
}

export const DEFAULT_MOBILE_CAPABILITIES: GraftMobileCapability[] = [...GRAFT_MOBILE_CAPABILITIES];
