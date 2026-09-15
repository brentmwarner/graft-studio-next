/**
 * Public contracts for the Graft agent-control gateway.
 *
 * New gateway tools decode these schemas before doing any work. Keeping the
 * limits here ensures the MCP surface, server implementation, and tests share
 * the same definition of an exact creation/wait plan.
 */
import { Schema } from "effect";

import { ProjectId, ThreadId, TurnId } from "./baseSchemas";
import { ModelSelection, ProviderKind } from "./orchestration";
import { ProviderModelDescriptor } from "./providerDiscovery";
import { ServerProviderAuthStatus } from "./server";

export const GRAFT_GATEWAY_MAX_THREADS_PER_OPERATION = 20;
export const GRAFT_GATEWAY_MAX_REQUEST_ID_LENGTH = 256;
export const GRAFT_GATEWAY_MAX_WAIT_MS = 60_000;

export const GraftGatewayErrorCode = Schema.Literals([
  "caller_session_inactive",
  "caller_turn_inactive",
  "capability_denied",
  "provider_unavailable",
  "model_unavailable",
  "model_option_unavailable",
  "idempotency_conflict",
  "creation_plan_locked",
  "creation_limit_exceeded",
  "thread_not_found",
  "wait_timed_out",
  "operation_failed",
]);
export type GraftGatewayErrorCode = typeof GraftGatewayErrorCode.Type;

export const GraftGatewayError = Schema.Struct({
  code: GraftGatewayErrorCode,
  message: Schema.String,
  details: Schema.optional(Schema.Unknown),
});
export type GraftGatewayError = typeof GraftGatewayError.Type;

export const GraftGatewayErrorResult = Schema.Struct({
  error: GraftGatewayError,
});
export type GraftGatewayErrorResult = typeof GraftGatewayErrorResult.Type;

export const GraftContextResult = Schema.Struct({
  harness: Schema.Struct({
    name: Schema.Literal("Graft"),
    policyVersion: Schema.String,
  }),
  caller: Schema.Struct({
    threadId: ThreadId,
    turnId: Schema.NullOr(TurnId),
    provider: ProviderKind,
    projectId: ProjectId,
  }),
  capabilities: Schema.Struct({
    threadRead: Schema.Boolean,
    threadCreate: Schema.Boolean,
    threadWait: Schema.Boolean,
    automations: Schema.Boolean,
  }),
});
export type GraftContextResult = typeof GraftContextResult.Type;

export const GraftCreateThreadSpec = Schema.Struct({
  prompt: Schema.String.check(Schema.isNonEmpty()),
  title: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  target: ModelSelection,
  projectId: Schema.optional(ProjectId),
  environment: Schema.optional(Schema.Literals(["local", "worktree"])),
  baseRef: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  // Legacy inputs remain decodable for replay/backward compatibility, but the
  // MCP catalog no longer advertises branch-backed worktree creation.
  baseBranch: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  branchName: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  runtimeMode: Schema.optional(Schema.Literals(["approval-required", "full-access"])),
});
export type GraftCreateThreadSpec = typeof GraftCreateThreadSpec.Type;

const GraftGatewayRequestId = Schema.String.check(Schema.isNonEmpty()).check(
  Schema.isMaxLength(GRAFT_GATEWAY_MAX_REQUEST_ID_LENGTH),
);

export const GraftCreateThreadsInput = Schema.Struct({
  requestId: GraftGatewayRequestId,
  threads: Schema.Array(GraftCreateThreadSpec)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(GRAFT_GATEWAY_MAX_THREADS_PER_OPERATION)),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type GraftCreateThreadsInput = typeof GraftCreateThreadsInput.Type;

export const GraftProviderCatalog = Schema.Struct({
  provider: ProviderKind,
  defaultModel: Schema.NullOr(Schema.String),
  models: Schema.Array(ProviderModelDescriptor),
  enabled: Schema.Boolean,
  available: Schema.Boolean,
  authStatus: Schema.optional(ServerProviderAuthStatus),
  source: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});
export type GraftProviderCatalog = typeof GraftProviderCatalog.Type;

export const GraftGatewayTargetOptionValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
]);
export type GraftGatewayTargetOptionValue = typeof GraftGatewayTargetOptionValue.Type;

export const GraftGatewayTargetOptionRule = Schema.Struct({
  key: Schema.String,
  valueType: Schema.Literals(["string", "number", "boolean"]),
  allowedValues: Schema.Array(GraftGatewayTargetOptionValue),
  allowedValuesSource: Schema.Literals(["provider-contract", "model-discovery"]),
});
export type GraftGatewayTargetOptionRule = typeof GraftGatewayTargetOptionRule.Type;

export const GraftGatewayTargetConstruction = Schema.Struct({
  modelValueSource: Schema.Literal("providers[].models[].slug"),
  primaryOptionKey: Schema.String,
  alternativeOptionKeys: Schema.Array(Schema.String),
  optionSelectionRule: Schema.String,
  providerOptions: Schema.Array(GraftGatewayTargetOptionRule),
  optionsByModel: Schema.Record(Schema.String, Schema.Array(GraftGatewayTargetOptionRule)),
  exampleTarget: Schema.NullOr(ModelSelection),
});
export type GraftGatewayTargetConstruction = typeof GraftGatewayTargetConstruction.Type;

export const GraftCapabilitiesResult = Schema.Struct({
  targetConstruction: Schema.Record(Schema.String, GraftGatewayTargetConstruction),
  providers: Schema.Array(GraftProviderCatalog),
  limits: Schema.Struct({
    maxThreadsPerOperation: Schema.Int,
    maxWaitMs: Schema.Int,
    oneCreationPlanPerActiveTurn: Schema.Boolean,
  }),
});
export type GraftCapabilitiesResult = typeof GraftCapabilitiesResult.Type;

export const GraftCreatedThreadResult = Schema.Struct({
  index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  threadId: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  target: ModelSelection,
  provider: ProviderKind,
  model: Schema.String,
  runtimeMode: Schema.Literals(["approval-required", "full-access"]),
  environment: Schema.Literals(["local", "worktree"]),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  status: Schema.Literal("task_dispatched"),
});
export type GraftCreatedThreadResult = typeof GraftCreatedThreadResult.Type;

export const GraftCreateThreadsResult = Schema.Struct({
  operationId: Schema.String,
  requestId: GraftGatewayRequestId,
  requestedCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  createdCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  threadIds: Schema.Array(ThreadId),
  threads: Schema.Array(GraftCreatedThreadResult),
});
export type GraftCreateThreadsResult = typeof GraftCreateThreadsResult.Type;

export const GraftWaitForThreadsInput = Schema.Struct({
  threadIds: Schema.Array(ThreadId)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(GRAFT_GATEWAY_MAX_THREADS_PER_OPERATION)),
  runIds: Schema.optional(
    Schema.Array(Schema.NullOr(TurnId)).check(
      Schema.isMaxLength(GRAFT_GATEWAY_MAX_THREADS_PER_OPERATION),
    ),
  ),
  timeoutMs: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).check(
      Schema.isLessThanOrEqualTo(GRAFT_GATEWAY_MAX_WAIT_MS),
    ),
  ),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type GraftWaitForThreadsInput = typeof GraftWaitForThreadsInput.Type;

export const GraftWaitedThreadResult = Schema.Struct({
  threadId: ThreadId,
  runId: Schema.NullOr(TurnId),
  state: Schema.Literals(["idle", "pending", "running", "completed", "error", "interrupted"]),
  terminal: Schema.Boolean,
  timedOut: Schema.Boolean,
  summary: Schema.NullOr(Schema.String),
  summaryTruncated: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  readThread: Schema.Struct({
    tool: Schema.Literal("graft_read_thread"),
    arguments: Schema.Struct({ threadId: ThreadId }),
  }),
});
export type GraftWaitedThreadResult = typeof GraftWaitedThreadResult.Type;

export const GraftWaitForThreadsResult = Schema.Struct({
  callerThreadId: ThreadId,
  runIds: Schema.Array(Schema.NullOr(TurnId)),
  allTerminal: Schema.Boolean,
  timedOut: Schema.Boolean,
  threads: Schema.Array(GraftWaitedThreadResult),
});
export type GraftWaitForThreadsResult = typeof GraftWaitForThreadsResult.Type;
