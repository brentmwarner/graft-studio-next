import { createHash } from "node:crypto";
import {
  GRAFT_DESKTOP_PROTOCOL_VERSION,
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
} from "@graft/shared";
import {
  DesktopHostStore,
  type DesktopHostStoredReceipt,
} from "./desktopHostStore.js";

export interface DesktopHostAuthorizationInput {
  commandType: string;
  sessionProfile: string;
  hostCapabilities: readonly GraftDesktopCapability[];
  sessionGrants: readonly GraftDesktopCapability[];
  clientCapabilities: readonly GraftDesktopCapability[];
}

export type DesktopHostAuthorizationDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export interface DesktopHostProtocolOptions {
  environmentLabel: string;
  daemonVersion: string;
  port: number;
  platform: GraftDesktopPlatform;
  capabilities: readonly GraftDesktopCapability[];
  enrollmentGrants: readonly GraftDesktopCapability[];
  getActivity?: () => {
    activeRunCount: number;
    activePtyCount: number;
  };
  authorizeCommand: (
    input: DesktopHostAuthorizationInput,
  ) => DesktopHostAuthorizationDecision;
  dispatchCommand: (
    session: GraftDesktopSessionRecord,
    command: { type: string; payload?: GraftDesktopJsonValue },
  ) => Promise<GraftDesktopJsonValue | undefined>;
}

export interface DesktopHostConnection {
  session: GraftDesktopSessionRecord;
  clientCapabilities: GraftDesktopCapability[];
  effectiveCapabilities: GraftDesktopCapability[];
}

export type DesktopHostOpenResult =
  | {
      ok: true;
      connection: DesktopHostConnection;
      messages: GraftDesktopHostMessage[];
    }
  | { ok: false; error: GraftDesktopError };

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

function hashCommand(
  command: GraftDesktopClientMessage & { envelope: "command" },
): string {
  return createHash("sha256")
    .update(canonicalJson(command.command), "utf8")
    .digest("hex");
}

function receiptMessage(
  receipt: DesktopHostStoredReceipt,
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
        receipt.error ??
        protocolError("internal_error", "The persisted command failed", false),
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

export class DesktopHostProtocol {
  constructor(
    private readonly store: DesktopHostStore,
    private readonly options: DesktopHostProtocolOptions,
  ) {}

  bootstrap(): GraftDesktopBootstrapResponse {
    const identity = this.store.getOrCreateIdentity(
      this.options.environmentLabel,
    );
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
      port: this.options.port,
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

  open(bearer: string, rawHello: unknown): DesktopHostOpenResult {
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
    const identity = this.store.getOrCreateIdentity(
      this.options.environmentLabel,
    );
    const connection: DesktopHostConnection = {
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
    connection: DesktopHostConnection,
    rawMessage: unknown,
  ): Promise<GraftDesktopHostMessage[]> {
    const parsed = GraftDesktopClientMessageSchema.safeParse(rawMessage);
    if (!parsed.success) {
      return [
        {
          envelope: "error",
          error: protocolError(
            "invalid_command",
            "The desktop host message is invalid",
            false,
          ),
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
      cursor = replay.events[replay.events.length - 1]!.cursor;
    }
    return messages;
  }

  private async handleCommand(
    connection: DesktopHostConnection,
    message: GraftDesktopClientMessage & { envelope: "command" },
  ): Promise<GraftDesktopHostMessage> {
    const activeSession = this.store.getActiveSession(
      connection.session.sessionId,
    );
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
    const authorization = this.options.authorizeCommand({
      commandType: message.command.type,
      sessionProfile: activeSession.profile,
      hostCapabilities: this.options.capabilities,
      sessionGrants: activeSession.grants,
      clientCapabilities: connection.clientCapabilities,
    });
    if (!authorization.allowed) {
      return {
        envelope: "error",
        error: protocolError(
          "forbidden",
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
      const rawResult = await this.options.dispatchCommand(
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
    } catch {
      const error = protocolError(
        "internal_error",
        "Desktop host command failed",
        false,
        message.commandId,
        message.requestId,
      );
      const receipt = this.store.failCommand({
        sessionId: connection.session.sessionId,
        commandId: message.commandId,
        error,
      });
      return {
        ...receiptMessage(receipt, false),
        ...(message.requestId ? { requestId: message.requestId } : {}),
      };
    }
  }
}
