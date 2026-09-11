import { z } from "zod";

/**
 * Graft desktop host protocol (v1).
 *
 * This wire contract is intentionally separate from the mobile companion
 * protocol. SSH supplies reachability; a desktop-scoped session supplies
 * authorization. Transport routes and credentials are never part of durable
 * host session records.
 */

export const GRAFT_DESKTOP_PROTOCOL_VERSION = 1 as const;
export const GRAFT_DESKTOP_MAX_BULK_TRANSFER_BYTES = 256 * 1024 * 1024;

export const GRAFT_DESKTOP_ENDPOINTS = Object.freeze({
  health: "/desktop/v1/health",
  enroll: "/desktop/v1/enroll",
  session: "/desktop/v1/session",
  socket: "/desktop/v1/ws",
  bulk: "/desktop/v1/bulk",
});

export const GRAFT_DESKTOP_CAPABILITIES = [
  "projects",
  "spaces",
  "threads",
  "runs",
  "providers",
  "files",
  "git",
  "diffs",
  "worktrees",
  "terminals",
  "skills",
  "mcp",
  "actions",
  "automations",
  "lsp",
  "usage",
  "external_mcp",
  "app_server",
  "cursor_replay",
  "bulk_transfer",
  "diagnostics",
] as const;
export type GraftDesktopCapability =
  (typeof GRAFT_DESKTOP_CAPABILITIES)[number];

/**
 * Commands implemented by the v1 headless host. The desktop and daemon share
 * this table so a remote window never advertises a command the daemon cannot
 * execute.
 */
export const GRAFT_DESKTOP_V1_HOST_COMMAND_CAPABILITIES = {
  "app/bootstrap": "projects",
  "project/list": "projects",
  "project/connect": "projects",
  "project/create": "projects",
  "project/reorder": "projects",
  "project/rename": "projects",
  "project/remove": "projects",
  "project/scan-local": "projects",
  "project/browse-directory": "projects",
  "project/create-new": "projects",
  "worktree/list": "worktrees",
  "worktree/create": "worktrees",
  "worktree/delete": "worktrees",
  "thread/list": "threads",
  "thread/create": "threads",
  "thread/update": "threads",
  "thread/updateTrackedPr": "threads",
  "thread/archive": "threads",
  "thread/unarchive": "threads",
  "thread/delete": "threads",
  "thread/events": "threads",
  "thread/events/page": "threads",
  "thread/parts": "threads",
  "thread/parts/page": "threads",
  "thread/checkpoints": "threads",
  "thread/checkpoints/page": "threads",
  "thread/fork": "threads",
  "turn/start": "runs",
  "turn/interrupt": "runs",
  "turn/steer": "runs",
  "run/list": "runs",
  "run/cancel": "runs",
  "run/retry": "runs",
  "session/close": "runs",
  "session/clear-context": "runs",
  "scheduler/stats": "runs",
  "provider/list": "providers",
  "model/list": "providers",
  "provider/cursor/models": "providers",
  "provider/cli/models": "providers",
  "provider/openai/models": "providers",
  "provider/ollama/models": "providers",
  "files/list": "files",
  "files/search": "files",
  "files/read": "files",
  "files/write": "files",
  "files/import": "files",
  "files/delete": "files",
  "files/move": "files",
  "files/create-folder": "files",
  "files/copy": "files",
  "files/watch": "files",
  "files/unwatch": "files",
  "git/status": "git",
  "git/statusRich": "git",
  "git/diff": "git",
  "git/shortstat": "git",
  "git/branches": "git",
  "git/branchTree": "git",
  "git/gitWorktrees": "git",
  "git/stage": "git",
  "git/revert": "git",
  "git/commit": "git",
  "git/push": "git",
  "git/aheadBehind": "git",
  "git/checkout": "git",
  "git/suggestBranchName": "git",
  "git/createBranch": "git",
  "pty/create": "terminals",
  "pty/snapshot": "terminals",
  "pty/write": "terminals",
  "pty/resize": "terminals",
  "pty/clear": "terminals",
  "pty/kill": "terminals",
  "usage/threadTotals": "usage",
} as const satisfies Readonly<Record<string, GraftDesktopCapability>>;
export const GraftDesktopCapabilitySchema = z.enum(GRAFT_DESKTOP_CAPABILITIES);

export const GraftDesktopSessionProfileSchema = z.literal("desktop_occupancy");
export type GraftDesktopSessionProfile = z.infer<
  typeof GraftDesktopSessionProfileSchema
>;

export const GraftDesktopCursorSchema = z.number().int().nonnegative();
export type GraftDesktopCursor = z.infer<typeof GraftDesktopCursorSchema>;

export const GraftDesktopCommandIdSchema = z.string().uuid();
export type GraftDesktopCommandId = z.infer<typeof GraftDesktopCommandIdSchema>;

export const GraftDesktopRequestIdSchema = z.string().min(1).max(128);
export type GraftDesktopRequestId = z.infer<typeof GraftDesktopRequestIdSchema>;

export const GraftDesktopEnvironmentIdSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/);
export type GraftDesktopEnvironmentId = z.infer<
  typeof GraftDesktopEnvironmentIdSchema
>;

export const GraftDesktopSessionIdSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/);
export type GraftDesktopSessionId = z.infer<typeof GraftDesktopSessionIdSchema>;

const DesktopOpaqueSecretSchema = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[A-Za-z0-9._~-]+$/);

export const GraftDesktopEnrollmentTokenSchema = DesktopOpaqueSecretSchema;
export type GraftDesktopEnrollmentToken = z.infer<
  typeof GraftDesktopEnrollmentTokenSchema
>;

export const GraftDesktopBearerSchema = DesktopOpaqueSecretSchema;
export type GraftDesktopBearer = z.infer<typeof GraftDesktopBearerSchema>;

export const GraftDesktopRequestHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export type GraftDesktopRequestHash = z.infer<
  typeof GraftDesktopRequestHashSchema
>;

export type GraftDesktopJsonValue =
  | null
  | boolean
  | number
  | string
  | GraftDesktopJsonValue[]
  | { [key: string]: GraftDesktopJsonValue };

export const GraftDesktopJsonValueSchema: z.ZodType<GraftDesktopJsonValue> =
  z.lazy(() =>
    z.union([
      z.null(),
      z.boolean(),
      z.number(),
      z.string(),
      z.array(GraftDesktopJsonValueSchema),
      z.record(GraftDesktopJsonValueSchema),
    ]),
  );

function uniqueCapabilities(
  values: readonly GraftDesktopCapability[],
): boolean {
  return new Set(values).size === values.length;
}

export const GraftDesktopCapabilityListSchema = z
  .array(GraftDesktopCapabilitySchema)
  .max(GRAFT_DESKTOP_CAPABILITIES.length)
  .refine(uniqueCapabilities, "Desktop capabilities must be unique");

export const GraftDesktopPlatformSchema = z
  .object({
    os: z.literal("linux"),
    arch: z.literal("x64"),
    libc: z.literal("glibc"),
  })
  .strict();
export type GraftDesktopPlatform = z.infer<typeof GraftDesktopPlatformSchema>;

export const GraftDesktopHealthSchema = z
  .object({
    service: z.literal("graft-host"),
    protocolVersion: z.literal(GRAFT_DESKTOP_PROTOCOL_VERSION),
    daemonVersion: z.string().min(1).max(80),
    environmentId: GraftDesktopEnvironmentIdSchema,
    environmentLabel: z.string().min(1).max(120),
    platform: GraftDesktopPlatformSchema,
    port: z.number().int().min(1).max(65_535),
    capabilities: GraftDesktopCapabilityListSchema,
    cursor: GraftDesktopCursorSchema,
    replayFloor: GraftDesktopCursorSchema,
    activeRunCount: z.number().int().nonnegative(),
    activePtyCount: z.number().int().nonnegative(),
  })
  .strict();
export type GraftDesktopHealth = z.infer<typeof GraftDesktopHealthSchema>;

export const GraftDesktopBootstrapResponseSchema = z
  .object({
    protocolVersion: z.literal(GRAFT_DESKTOP_PROTOCOL_VERSION),
    environmentId: GraftDesktopEnvironmentIdSchema,
    environmentLabel: z.string().min(1).max(120),
    daemonVersion: z.string().min(1).max(80),
    platform: GraftDesktopPlatformSchema,
    port: z.number().int().min(1).max(65_535),
    enrollmentToken: GraftDesktopEnrollmentTokenSchema,
    enrollmentExpiresAt: z.number().int().nonnegative(),
    activeRunCount: z.number().int().nonnegative(),
    activePtyCount: z.number().int().nonnegative(),
  })
  .strict();
export type GraftDesktopBootstrapResponse = z.infer<
  typeof GraftDesktopBootstrapResponseSchema
>;

export const GraftDesktopEnrollmentRequestSchema = z
  .object({
    protocolVersion: z.literal(GRAFT_DESKTOP_PROTOCOL_VERSION),
    enrollmentToken: GraftDesktopEnrollmentTokenSchema,
    clientId: z.string().min(1).max(128),
    clientLabel: z.string().min(1).max(120),
    clientVersion: z.string().min(1).max(80),
    capabilities: GraftDesktopCapabilityListSchema,
  })
  .strict();
export type GraftDesktopEnrollmentRequest = z.infer<
  typeof GraftDesktopEnrollmentRequestSchema
>;

export const GraftDesktopSessionRecordSchema = z
  .object({
    sessionId: GraftDesktopSessionIdSchema,
    environmentId: GraftDesktopEnvironmentIdSchema,
    profile: GraftDesktopSessionProfileSchema,
    clientId: z.string().min(1).max(128),
    clientLabel: z.string().min(1).max(120),
    grants: GraftDesktopCapabilityListSchema,
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    lastSeenAt: z.number().int().nonnegative(),
    revokedAt: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type GraftDesktopSessionRecord = z.infer<
  typeof GraftDesktopSessionRecordSchema
>;

export const GraftDesktopEnrollmentResponseSchema = z
  .object({
    protocolVersion: z.literal(GRAFT_DESKTOP_PROTOCOL_VERSION),
    session: GraftDesktopSessionRecordSchema,
    bearer: GraftDesktopBearerSchema,
  })
  .strict();
export type GraftDesktopEnrollmentResponse = z.infer<
  typeof GraftDesktopEnrollmentResponseSchema
>;

export const GraftDesktopEnvironmentSchema = z
  .object({
    environmentId: GraftDesktopEnvironmentIdSchema,
    environmentLabel: z.string().min(1).max(120),
    daemonVersion: z.string().min(1).max(80),
    protocolVersion: z.literal(GRAFT_DESKTOP_PROTOCOL_VERSION),
    capabilities: GraftDesktopCapabilityListSchema,
    cursor: GraftDesktopCursorSchema,
    replayFloor: GraftDesktopCursorSchema,
  })
  .strict();
export type GraftDesktopEnvironment = z.infer<
  typeof GraftDesktopEnvironmentSchema
>;

export const GraftDesktopCommandEnvelopeSchema = z
  .object({
    version: z.literal(1),
    type: z.string().min(1).max(160),
    payload: GraftDesktopJsonValueSchema.optional(),
  })
  .strict();
export type GraftDesktopCommandEnvelope = z.infer<
  typeof GraftDesktopCommandEnvelopeSchema
>;

export const GraftDesktopCommandReceiptSchema = z
  .object({
    commandId: GraftDesktopCommandIdSchema,
    requestHash: GraftDesktopRequestHashSchema,
    status: z.enum(["accepted", "completed", "failed"]),
    replayed: z.boolean(),
    acceptedAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type GraftDesktopCommandReceipt = z.infer<
  typeof GraftDesktopCommandReceiptSchema
>;

export const GraftDesktopErrorCodeSchema = z.enum([
  "unauthorized",
  "forbidden",
  "unknown_command",
  "invalid_command",
  "protocol_mismatch",
  "command_id_conflict",
  "command_outcome_unknown",
  "cursor_expired",
  "host_unavailable",
  "internal_error",
]);
export type GraftDesktopErrorCode = z.infer<typeof GraftDesktopErrorCodeSchema>;

export const GraftDesktopErrorSchema = z
  .object({
    code: GraftDesktopErrorCodeSchema,
    message: z.string().min(1).max(1_000),
    commandId: GraftDesktopCommandIdSchema.optional(),
    requestId: GraftDesktopRequestIdSchema.optional(),
    retryable: z.boolean(),
  })
  .strict();
export type GraftDesktopError = z.infer<typeof GraftDesktopErrorSchema>;

export const GraftDesktopClientMessageSchema = z.discriminatedUnion(
  "envelope",
  [
    z
      .object({
        envelope: z.literal("hello"),
        protocolVersion: z.literal(GRAFT_DESKTOP_PROTOCOL_VERSION),
        clientVersion: z.string().min(1).max(80),
        capabilities: GraftDesktopCapabilityListSchema,
        afterCursor: GraftDesktopCursorSchema.optional(),
      })
      .strict(),
    z
      .object({
        envelope: z.literal("ping"),
        at: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        envelope: z.literal("replay"),
        afterCursor: GraftDesktopCursorSchema,
      })
      .strict(),
    z
      .object({
        envelope: z.literal("command"),
        commandId: GraftDesktopCommandIdSchema,
        requestId: GraftDesktopRequestIdSchema.optional(),
        command: GraftDesktopCommandEnvelopeSchema,
      })
      .strict(),
  ],
);
export type GraftDesktopClientMessage = z.infer<
  typeof GraftDesktopClientMessageSchema
>;

export const GraftDesktopStreamChannelSchema = z.enum([
  "worker",
  "pty",
  "file_watch",
  "lsp",
  "progress",
]);
export type GraftDesktopStreamChannel = z.infer<
  typeof GraftDesktopStreamChannelSchema
>;

export const GraftDesktopStreamFrameSchema = z
  .object({
    envelope: z.literal("stream"),
    streamId: z.string().uuid(),
    channel: GraftDesktopStreamChannelSchema,
    sequence: z.number().int().nonnegative(),
    payload: GraftDesktopJsonValueSchema,
    eof: z.boolean().optional(),
  })
  .strict();
export type GraftDesktopStreamFrame = z.infer<
  typeof GraftDesktopStreamFrameSchema
>;

export const GraftDesktopHostMessageSchema = z
  .discriminatedUnion("envelope", [
    z
      .object({
        envelope: z.literal("welcome"),
        environment: GraftDesktopEnvironmentSchema,
        session: GraftDesktopSessionRecordSchema,
        capabilities: GraftDesktopCapabilityListSchema,
      })
      .strict(),
    GraftDesktopStreamFrameSchema,
    z
      .object({
        envelope: z.literal("pong"),
        at: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        envelope: z.literal("receipt"),
        receipt: GraftDesktopCommandReceiptSchema,
      })
      .strict(),
    z
      .object({
        envelope: z.literal("response"),
        commandId: GraftDesktopCommandIdSchema,
        requestId: GraftDesktopRequestIdSchema.optional(),
        receipt: GraftDesktopCommandReceiptSchema,
        result: GraftDesktopJsonValueSchema.optional(),
        error: GraftDesktopErrorSchema.optional(),
      })
      .strict(),
    z
      .object({
        envelope: z.literal("event"),
        cursor: GraftDesktopCursorSchema,
        occurredAt: z.number().int().nonnegative(),
        event: GraftDesktopJsonValueSchema,
      })
      .strict(),
    z
      .object({
        envelope: z.literal("snapshot_required"),
        reason: z.enum(["cursor_expired", "schema_changed", "resync"]),
        replayFloor: GraftDesktopCursorSchema,
      })
      .strict(),
    z
      .object({
        envelope: z.literal("error"),
        error: GraftDesktopErrorSchema,
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (value.envelope !== "response") return;
    const hasResult = Object.prototype.hasOwnProperty.call(value, "result");
    const hasError = value.error !== undefined;
    if (hasResult === hasError) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Desktop responses require exactly one result or error",
      });
    }
  });
export type GraftDesktopHostMessage = z.infer<
  typeof GraftDesktopHostMessageSchema
>;

export const GraftDesktopBulkTransferTicketSchema = z
  .object({
    transferId: z.string().uuid(),
    direction: z.enum(["upload", "download"]),
    mediaType: z.string().min(1).max(200),
    sizeBytes: z.number().int().nonnegative(),
    sha256: GraftDesktopRequestHashSchema,
    expiresAt: z.number().int().nonnegative(),
  })
  .strict();
export type GraftDesktopBulkTransferTicket = z.infer<
  typeof GraftDesktopBulkTransferTicketSchema
>;

export const GraftDesktopBulkUploadRequestSchema = z
  .object({
    operation: z.literal("create_upload"),
    mediaType: z.string().min(1).max(200),
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(GRAFT_DESKTOP_MAX_BULK_TRANSFER_BYTES),
    sha256: GraftDesktopRequestHashSchema,
  })
  .strict();
export type GraftDesktopBulkUploadRequest = z.infer<
  typeof GraftDesktopBulkUploadRequestSchema
>;

export const GraftDesktopBulkUploadResultSchema = z
  .object({
    ok: z.literal(true),
    ticket: GraftDesktopBulkTransferTicketSchema,
  })
  .strict();
export type GraftDesktopBulkUploadResult = z.infer<
  typeof GraftDesktopBulkUploadResultSchema
>;

export const GraftDesktopAuthorizationRejectionSchema = z
  .object({
    endpoint: z.enum(["enroll", "socket", "bulk"]),
    sessionId: GraftDesktopSessionIdSchema.optional(),
    profile: GraftDesktopSessionProfileSchema.optional(),
    commandType: z.string().min(1).max(160).optional(),
    requiredCapability: GraftDesktopCapabilitySchema.optional(),
    reason: z.enum([
      "missing_session",
      "revoked_session",
      "expired_session",
      "wrong_profile",
      "missing_grant",
      "unsupported_command",
    ]),
  })
  .strict();
export type GraftDesktopAuthorizationRejection = z.infer<
  typeof GraftDesktopAuthorizationRejectionSchema
>;

/**
 * Computes the host-enforced capability set. The host's order is retained so
 * welcome messages and diagnostics remain deterministic.
 */
export function negotiateDesktopCapabilities(
  hostCapabilities: readonly GraftDesktopCapability[],
  sessionGrants: readonly GraftDesktopCapability[],
  clientCapabilities: readonly GraftDesktopCapability[],
): GraftDesktopCapability[] {
  const grants = new Set(sessionGrants);
  const supported = new Set(clientCapabilities);
  return hostCapabilities.filter(
    (capability, index) =>
      hostCapabilities.indexOf(capability) === index &&
      grants.has(capability) &&
      supported.has(capability),
  );
}

export function assertNeverDesktop(value: never): never {
  throw new Error(
    `Unhandled desktop host protocol variant: ${JSON.stringify(value)}`,
  );
}
