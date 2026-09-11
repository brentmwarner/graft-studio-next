import { createHash } from "node:crypto";
import {
  GRAFT_DESKTOP_PROTOCOL_VERSION,
  GRAFT_DESKTOP_V1_HOST_COMMAND_CAPABILITIES,
  GraftDesktopClientMessageSchema,
  GraftDesktopEnrollmentRequestSchema,
  GraftDesktopJsonValueSchema,
  assertNeverDesktop,
  negotiateDesktopCapabilities,
  type GraftDesktopBootstrapResponse,
  type GraftDesktopCapability,
  type GraftDesktopClientMessage,
  type GraftDesktopEnrollmentRequest,
  type GraftDesktopEnrollmentResponse,
  type GraftDesktopError,
  type GraftDesktopHostMessage,
  type GraftDesktopJsonValue,
  type GraftDesktopPlatform,
  type GraftDesktopSessionRecord,
} from "@graft/desktop-contract";

import { OccupancyStore, type OccupancyStoredReceipt } from "./occupancyStore";

export interface OccupancyAuthorizationInput {
  commandType: string;
  sessionProfile: string;
  hostCapabilities: readonly GraftDesktopCapability[];
  sessionGrants: readonly GraftDesktopCapability[];
  clientCapabilities: readonly GraftDesktopCapability[];
}

export type OccupancyAuthorizationDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export interface OccupancyProtocolOptions {
  environmentLabel: string;
  daemonVersion: string;
  port: number | (() => number);
  platform: GraftDesktopPlatform;
  capabilities: readonly GraftDesktopCapability[];
  enrollmentGrants: readonly GraftDesktopCapability[];
  getActivity?: () => {
    activeRunCount: number;
    activePtyCount: number;
  };
  authorizeCommand?: (
    input: OccupancyAuthorizationInput,
  ) => OccupancyAuthorizationDecision;
  dispatchCommand?: (
    session: GraftDesktopSessionRecord,
    command: { type: string; payload?: GraftDesktopJsonValue },
  ) => Promise<GraftDesktopJsonValue | undefined>;
}

export interface OccupancyConnection {
  session: GraftDesktopSessionRecord;
  clientCapabilities: GraftDesktopCapability[];
  effectiveCapabilities: GraftDesktopCapability[];
}

export type OccupancyOpenResult =
  | {
      ok: true;
      connection: OccupancyConnection;
      messages: GraftDesktopHostMessage[];
    }
  | { ok: false; error: GraftDesktopError };

const COMMAND_CAPABILITIES = new Map<string, GraftDesktopCapability>(
  Object.entries(GRAFT_DESKTOP_V1_HOST_COMMAND_CAPABILITIES),
);

export function authorizeDesktopOccupancyCommand(
  input: OccupancyAuthorizationInput,
): OccupancyAuthorizationDecision {
  if (input.sessionProfile !== "desktop_occupancy") {
    return { allowed: false, reason: "wrong_profile" };
  }
  const required = COMMAND_CAPABILITIES.get(input.commandType);
  if (!required) {
    return { allowed: false, reason: "unsupported_command" };
  }
  if (!input.sessionGrants.includes(required) || !input.hostCapabilities.includes(required)) {
    return { allowed: false, reason: "missing_grant" };
  }
  return { allowed: true };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function hashCommand(command: GraftDesktopClientMessage & { envelope: "command" }): string {
  return createHash("sha256").update(canonicalJson(command.command), "utf8").digest("hex");
}

function protocolError(
  code: GraftDesktopError["code"],
  message: string,
  retryable: boolean,
  commandId?: string,
  requestId?: string,
): GraftDesktopError {
  return {
    code,
    message,
    retryable,
    ...(commandId ? { commandId } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

function receiptMessage(
  receipt: OccupancyStoredReceipt,
  replayed: boolean,
): GraftDesktopHostMessage & { envelope: "response" } {
  const base = {
    envelope: "response" as const,
    commandId: receipt.commandId,
    receipt: {
      commandId: receipt.commandId,
      requestHash: receipt.requestHash,
      status: receipt.status,
      replayed,
      acceptedAt: receipt.acceptedAt,
      completedAt: receipt.completedAt,
    },
  };
  if (receipt.status === "completed") {
    return { ...base, result: receipt.result ?? null };
  }
  if (receipt.status === "failed") {
    return {
      ...base,
      error:
        receipt.error ?? protocolError("internal_error", "The persisted command failed", false),
    };
  }
  return {
    ...base,
    error: protocolError(
      "command_outcome_unknown",
      "The host accepted this command before restarting; its outcome is unknown and it will not be repeated automatically",
      false,
      receipt.commandId,
    ),
  };
}

export class OccupancyCommandError extends Error {
  constructor(
    readonly code: GraftDesktopError["code"],
    message: string,
  ) {
    super(message);
    this.name = "OccupancyCommandError";
  }
}

async function unsupportedDispatch(): Promise<GraftDesktopJsonValue> {
  throw new OccupancyCommandError(
    "unknown_command",
    "This desktop host command is not implemented on this Synara occupancy adapter",
  );
}

export class OccupancyProtocol {
  constructor(
    private readonly store: OccupancyStore,
    private readonly options: OccupancyProtocolOptions,
  ) {}

  private listenPort(): number {
    const port = this.options.port;
    return typeof port === "function" ? port() : port;
  }

  bootstrap(): GraftDesktopBootstrapResponse {
    const identity = this.store.getOrCreateIdentity(this.options.environmentLabel);
    const enrollment = this.store.issueEnrollmentToken();
    const activity = this.options.getActivity?.() ?? {
      activeRunCount: 0,
      activePtyCount: 0,
    };
    return {
      protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
      environmentId: identity.environmentId,
      environmentLabel: identity.environmentLabel,
      daemonVersion: this.options.daemonVersion,
      platform: this.options.platform,
      port: this.listenPort(),
      enrollmentToken: enrollment.token,
      enrollmentExpiresAt: enrollment.expiresAt,
      ...activity,
    };
  }

  enroll(rawRequest: unknown): GraftDesktopEnrollmentResponse | null {
    const request: GraftDesktopEnrollmentRequest =
      GraftDesktopEnrollmentRequestSchema.parse(rawRequest);
    const enrolled = this.store.consumeEnrollmentToken({
      token: request.enrollmentToken,
      clientId: request.clientId,
      clientLabel: request.clientLabel,
      grants: this.options.enrollmentGrants,
    });
    if (!enrolled) return null;
    return {
      protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
      session: enrolled.session,
      bearer: enrolled.bearer,
    };
  }

  health() {
    const identity = this.store.getOrCreateIdentity(this.options.environmentLabel);
    return {
      identity,
      replay: this.store.getReplayState(),
      activity: this.options.getActivity?.() ?? { activeRunCount: 0, activePtyCount: 0 },
    };
  }

  open(bearer: string, rawHello: unknown): OccupancyOpenResult {
    const parsed = GraftDesktopClientMessageSchema.safeParse(rawHello);
    if (!parsed.success || parsed.data.envelope !== "hello") {
      return {
        ok: false,
        error: protocolError(
          "protocol_mismatch",
          "The first desktop host message must be a valid hello envelope",
          false,
        ),
      };
    }
    const session = this.store.authenticateBearer(bearer);
    if (!session) {
      return {
        ok: false,
        error: protocolError(
          "unauthorized",
          "The desktop occupancy session is missing, expired, or revoked",
          false,
        ),
      };
    }

    const effectiveCapabilities = negotiateDesktopCapabilities(
      this.options.capabilities,
      session.grants,
      parsed.data.capabilities,
    );
    const replayState = this.store.getReplayState();
    const identity = this.store.getOrCreateIdentity(this.options.environmentLabel);
    const connection: OccupancyConnection = {
      session,
      clientCapabilities: parsed.data.capabilities,
      effectiveCapabilities,
    };
    const messages: GraftDesktopHostMessage[] = [
      {
        envelope: "welcome",
        environment: {
          environmentId: session.environmentId,
          environmentLabel: identity.environmentLabel,
          daemonVersion: this.options.daemonVersion,
          protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
          capabilities: [...this.options.capabilities],
          ...replayState,
        },
        session,
        capabilities: effectiveCapabilities,
      },
    ];
    if (parsed.data.afterCursor !== undefined) {
      messages.push(...this.replay(parsed.data.afterCursor));
    }
    return { ok: true, connection, messages };
  }

  async handle(
    connection: OccupancyConnection,
    rawMessage: unknown,
  ): Promise<GraftDesktopHostMessage[]> {
    const parsed = GraftDesktopClientMessageSchema.safeParse(rawMessage);
    if (!parsed.success) {
      return [
        {
          envelope: "error",
          error: protocolError("invalid_command", "The desktop host message is invalid", false),
        },
      ];
    }

    switch (parsed.data.envelope) {
      case "hello":
        return [
          {
            envelope: "error",
            error: protocolError(
              "protocol_mismatch",
              "A desktop host connection can only be initialized once",
              false,
            ),
          },
        ];
      case "ping":
        return [{ envelope: "pong", at: parsed.data.at }];
      case "replay":
        return this.replay(parsed.data.afterCursor);
      case "command":
        return [await this.handleCommand(connection, parsed.data)];
      default:
        return assertNeverDesktop(parsed.data);
    }
  }

  private replay(afterCursor: number): GraftDesktopHostMessage[] {
    const pageSize = 1_000;
    let cursor = afterCursor;
    const messages: GraftDesktopHostMessage[] = [];
    while (true) {
      const replay = this.store.replayEvents(cursor, pageSize);
      if (replay.kind === "cursor_expired") {
        return [
          {
            envelope: "snapshot_required",
            reason: "cursor_expired",
            replayFloor: replay.replayFloor,
          },
        ];
      }
      messages.push(
        ...replay.events.map((event) => ({
          envelope: "event" as const,
          cursor: event.cursor,
          occurredAt: event.occurredAt,
          event: event.event,
        })),
      );
      if (replay.events.length < pageSize) break;
      const last = replay.events[replay.events.length - 1];
      if (!last) break;
      cursor = last.cursor;
    }
    return messages;
  }

  private async handleCommand(
    connection: OccupancyConnection,
    message: GraftDesktopClientMessage & { envelope: "command" },
  ): Promise<GraftDesktopHostMessage> {
    const activeSession = this.store.getActiveSession(connection.session.sessionId);
    if (!activeSession) {
      return {
        envelope: "error",
        error: protocolError(
          "unauthorized",
          "The desktop occupancy session is missing, expired, or revoked",
          false,
          message.commandId,
          message.requestId,
        ),
      };
    }
    const authorization = (this.options.authorizeCommand ?? authorizeDesktopOccupancyCommand)({
      commandType: message.command.type,
      sessionProfile: activeSession.profile,
      hostCapabilities: this.options.capabilities,
      sessionGrants: activeSession.grants,
      clientCapabilities: connection.clientCapabilities,
    });
    if (!authorization.allowed) {
      const code = authorization.reason === "unsupported_command" ? "unknown_command" : "forbidden";
      return {
        envelope: "error",
        error: protocolError(
          code,
          `Desktop host command rejected: ${authorization.reason}`,
          false,
          message.commandId,
          message.requestId,
        ),
      };
    }

    const reservation = this.store.reserveCommand({
      sessionId: connection.session.sessionId,
      commandId: message.commandId,
      requestHash: hashCommand(message),
    });
    if (reservation.kind === "conflict") {
      return {
        envelope: "error",
        error: protocolError(
          "command_id_conflict",
          "This command ID was already used for a different command",
          false,
          message.commandId,
          message.requestId,
        ),
      };
    }
    if (reservation.kind === "replay") {
      return {
        ...receiptMessage(reservation.receipt, true),
        ...(message.requestId ? { requestId: message.requestId } : {}),
      };
    }

    try {
      const rawResult = await (this.options.dispatchCommand ?? unsupportedDispatch)(
        activeSession,
        message.command,
      );
      const result = GraftDesktopJsonValueSchema.parse(rawResult ?? null);
      const receipt = this.store.completeCommand({
        sessionId: connection.session.sessionId,
        commandId: message.commandId,
        result,
      });
      return {
        ...receiptMessage(receipt, false),
        ...(message.requestId ? { requestId: message.requestId } : {}),
      };
    } catch (error) {
      const protocolCode =
        error instanceof OccupancyCommandError ? error.code : "internal_error";
      const protocolMessage =
        error instanceof Error ? error.message : "Desktop host command failed";
      const occupancyError = protocolError(
        protocolCode,
        protocolMessage,
        false,
        message.commandId,
        message.requestId,
      );
      const receipt = this.store.failCommand({
        sessionId: connection.session.sessionId,
        commandId: message.commandId,
        error: occupancyError,
      });
      return {
        ...receiptMessage(receipt, false),
        ...(message.requestId ? { requestId: message.requestId } : {}),
      };
    }
  }
}
