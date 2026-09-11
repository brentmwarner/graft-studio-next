import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Sqlite from "better-sqlite3";
import {
  GraftDesktopCapabilityListSchema,
  GraftDesktopErrorSchema,
  GraftDesktopJsonValueSchema,
  GraftDesktopSessionRecordSchema,
  type GraftDesktopCapability,
  type GraftDesktopError,
  type GraftDesktopJsonValue,
  type GraftDesktopSessionRecord,
} from "@graft/shared";

const DESKTOP_HOST_SCHEMA_VERSION = 1;
const DEFAULT_ENROLLMENT_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1_000;

interface IdentityDbRow {
  environmentId: string;
  environmentLabel: string;
  createdAt: number;
}

interface SessionDbRow {
  sessionId: string;
  environmentId: string;
  profile: "desktop_occupancy";
  clientId: string;
  clientLabel: string;
  grantsJson: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
}

interface ReceiptDbRow {
  sessionId: string;
  commandId: string;
  requestHash: string;
  status: "accepted" | "completed" | "failed";
  resultJson: string | null;
  errorJson: string | null;
  acceptedAt: number;
  completedAt: number | null;
}

interface EventDbRow {
  cursor: number;
  occurredAt: number;
  eventJson: string;
}

export interface DesktopHostIdentity {
  environmentId: string;
  environmentLabel: string;
  createdAt: number;
}

export interface DesktopHostEnrollment {
  session: GraftDesktopSessionRecord;
  bearer: string;
}

export interface DesktopHostStoredReceipt {
  sessionId: string;
  commandId: string;
  requestHash: string;
  status: "accepted" | "completed" | "failed";
  result?: GraftDesktopJsonValue;
  error?: GraftDesktopError;
  acceptedAt: number;
  completedAt: number | null;
}

export type DesktopHostCommandReservation =
  | { kind: "new"; receipt: DesktopHostStoredReceipt }
  | { kind: "replay"; receipt: DesktopHostStoredReceipt }
  | { kind: "conflict"; receipt: DesktopHostStoredReceipt };

export interface DesktopHostStoredEvent {
  cursor: number;
  occurredAt: number;
  event: GraftDesktopJsonValue;
}

export type DesktopHostReplayResult =
  | {
      kind: "events";
      cursor: number;
      replayFloor: number;
      events: DesktopHostStoredEvent[];
    }
  | {
      kind: "cursor_expired";
      cursor: number;
      replayFloor: number;
    };

export interface DesktopHostStoreOptions {
  now?: () => number;
  randomSecret?: () => string;
  sqlite?: typeof Sqlite;
}

function digestSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}

function parseJson(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

function sessionFromRow(row: SessionDbRow): GraftDesktopSessionRecord {
  return GraftDesktopSessionRecordSchema.parse({
    sessionId: row.sessionId,
    environmentId: row.environmentId,
    profile: row.profile,
    clientId: row.clientId,
    clientLabel: row.clientLabel,
    grants: GraftDesktopCapabilityListSchema.parse(parseJson(row.grantsJson)),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
  });
}

function receiptFromRow(row: ReceiptDbRow): DesktopHostStoredReceipt {
  const receipt: DesktopHostStoredReceipt = {
    sessionId: row.sessionId,
    commandId: row.commandId,
    requestHash: row.requestHash,
    status: row.status,
    acceptedAt: row.acceptedAt,
    completedAt: row.completedAt,
  };
  if (row.resultJson !== null) {
    receipt.result = GraftDesktopJsonValueSchema.parse(
      parseJson(row.resultJson),
    );
  }
  if (row.errorJson !== null) {
    receipt.error = GraftDesktopErrorSchema.parse(parseJson(row.errorJson));
  }
  return receipt;
}

export class DesktopHostStore {
  private readonly db: Sqlite.Database;
  private readonly now: () => number;
  private readonly randomSecret: () => string;

  constructor(dbPath: string, options: DesktopHostStoreOptions = {}) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const Database = options.sqlite ?? Sqlite;
    this.db = new Database(dbPath);
    this.now = options.now ?? Date.now;
    this.randomSecret = options.randomSecret ?? generateSecret;
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS desktop_host_schema_version (version INTEGER NOT NULL)",
    );
    const current = this.db
      .prepare("SELECT version FROM desktop_host_schema_version LIMIT 1")
      .get() as { version: number } | undefined;
    if (!current) {
      this.db
        .prepare("INSERT INTO desktop_host_schema_version (version) VALUES (0)")
        .run();
    }
    if ((current?.version ?? 0) >= DESKTOP_HOST_SCHEMA_VERSION) return;

    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE desktop_host_identity (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          environmentId TEXT NOT NULL UNIQUE,
          environmentLabel TEXT NOT NULL,
          createdAt INTEGER NOT NULL
        );

        CREATE TABLE desktop_host_enrollment_tokens (
          tokenDigest TEXT PRIMARY KEY,
          createdAt INTEGER NOT NULL,
          expiresAt INTEGER NOT NULL,
          consumedAt INTEGER
        );

        CREATE TABLE desktop_host_sessions (
          sessionId TEXT PRIMARY KEY,
          environmentId TEXT NOT NULL,
          profile TEXT NOT NULL CHECK (profile = 'desktop_occupancy'),
          clientId TEXT NOT NULL,
          clientLabel TEXT NOT NULL,
          grantsJson TEXT NOT NULL,
          bearerDigest TEXT NOT NULL UNIQUE,
          createdAt INTEGER NOT NULL,
          expiresAt INTEGER NOT NULL,
          lastSeenAt INTEGER NOT NULL,
          revokedAt INTEGER,
          FOREIGN KEY (environmentId) REFERENCES desktop_host_identity(environmentId)
        );
        CREATE INDEX idx_desktop_host_sessions_bearer_digest
          ON desktop_host_sessions(bearerDigest);

        CREATE TABLE desktop_host_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          cursor INTEGER NOT NULL,
          replayFloor INTEGER NOT NULL
        );
        INSERT INTO desktop_host_state (singleton, cursor, replayFloor)
          VALUES (1, 0, 0);

        CREATE TABLE desktop_host_events (
          cursor INTEGER PRIMARY KEY,
          occurredAt INTEGER NOT NULL,
          eventJson TEXT NOT NULL
        );

        CREATE TABLE desktop_host_receipts (
          sessionId TEXT NOT NULL,
          commandId TEXT NOT NULL,
          requestHash TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('accepted', 'completed', 'failed')),
          resultJson TEXT,
          errorJson TEXT,
          acceptedAt INTEGER NOT NULL,
          completedAt INTEGER,
          PRIMARY KEY (sessionId, commandId),
          FOREIGN KEY (sessionId) REFERENCES desktop_host_sessions(sessionId)
        );
      `);
      this.db
        .prepare("UPDATE desktop_host_schema_version SET version = ?")
        .run(DESKTOP_HOST_SCHEMA_VERSION);
    })();
  }

  getOrCreateIdentity(environmentLabel: string): DesktopHostIdentity {
    const existing = this.db
      .prepare(
        "SELECT environmentId, environmentLabel, createdAt FROM desktop_host_identity WHERE singleton = 1",
      )
      .get() as IdentityDbRow | undefined;
    if (existing) return existing;

    const identity: DesktopHostIdentity = {
      environmentId: `host-${randomUUID()}`,
      environmentLabel,
      createdAt: this.now(),
    };
    this.db
      .prepare(
        `INSERT INTO desktop_host_identity
          (singleton, environmentId, environmentLabel, createdAt)
         VALUES (1, @environmentId, @environmentLabel, @createdAt)`,
      )
      .run(identity);
    return identity;
  }

  getIdentity(): DesktopHostIdentity | null {
    const row = this.db
      .prepare(
        "SELECT environmentId, environmentLabel, createdAt FROM desktop_host_identity WHERE singleton = 1",
      )
      .get() as IdentityDbRow | undefined;
    return row ?? null;
  }

  issueEnrollmentToken(ttlMs = DEFAULT_ENROLLMENT_TTL_MS): {
    token: string;
    expiresAt: number;
  } {
    const token = this.randomSecret();
    const createdAt = this.now();
    const expiresAt = createdAt + ttlMs;
    this.db
      .prepare(
        `INSERT INTO desktop_host_enrollment_tokens
          (tokenDigest, createdAt, expiresAt, consumedAt)
         VALUES (?, ?, ?, NULL)`,
      )
      .run(digestSecret(token), createdAt, expiresAt);
    return { token, expiresAt };
  }

  consumeEnrollmentToken(input: {
    token: string;
    clientId: string;
    clientLabel: string;
    grants: readonly GraftDesktopCapability[];
    sessionTtlMs?: number;
  }): DesktopHostEnrollment | null {
    const identity = this.getIdentity();
    if (!identity)
      throw new Error("Desktop host identity has not been initialized");
    const grants = GraftDesktopCapabilityListSchema.parse(input.grants);
    const now = this.now();
    const tokenDigest = digestSecret(input.token);

    return this.db.transaction((): DesktopHostEnrollment | null => {
      const token = this.db
        .prepare(
          `SELECT expiresAt, consumedAt
           FROM desktop_host_enrollment_tokens
           WHERE tokenDigest = ? LIMIT 1`,
        )
        .get(tokenDigest) as
        | { expiresAt: number; consumedAt: number | null }
        | undefined;
      if (!token || token.consumedAt !== null || token.expiresAt <= now) {
        return null;
      }

      const consumed = this.db
        .prepare(
          `UPDATE desktop_host_enrollment_tokens
           SET consumedAt = ?
           WHERE tokenDigest = ? AND consumedAt IS NULL`,
        )
        .run(now, tokenDigest);
      if (consumed.changes !== 1) return null;

      const bearer = this.randomSecret();
      const session: GraftDesktopSessionRecord = {
        sessionId: `session-${randomUUID()}`,
        environmentId: identity.environmentId,
        profile: "desktop_occupancy",
        clientId: input.clientId,
        clientLabel: input.clientLabel,
        grants,
        createdAt: now,
        expiresAt: now + (input.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS),
        lastSeenAt: now,
        revokedAt: null,
      };
      GraftDesktopSessionRecordSchema.parse(session);
      this.db
        .prepare(
          `INSERT INTO desktop_host_sessions
            (sessionId, environmentId, profile, clientId, clientLabel, grantsJson,
             bearerDigest, createdAt, expiresAt, lastSeenAt, revokedAt)
           VALUES
            (@sessionId, @environmentId, @profile, @clientId, @clientLabel,
             @grantsJson, @bearerDigest, @createdAt, @expiresAt, @lastSeenAt,
             @revokedAt)`,
        )
        .run({
          ...session,
          grantsJson: JSON.stringify(session.grants),
          bearerDigest: digestSecret(bearer),
        });
      return { session, bearer };
    })();
  }

  authenticateBearer(bearer: string): GraftDesktopSessionRecord | null {
    const now = this.now();
    const row = this.db
      .prepare(
        `SELECT sessionId, environmentId, profile, clientId, clientLabel,
                grantsJson, createdAt, expiresAt, lastSeenAt, revokedAt
         FROM desktop_host_sessions
         WHERE bearerDigest = ? LIMIT 1`,
      )
      .get(digestSecret(bearer)) as SessionDbRow | undefined;
    if (!row || row.revokedAt !== null || row.expiresAt <= now) return null;
    this.db
      .prepare(
        "UPDATE desktop_host_sessions SET lastSeenAt = ? WHERE sessionId = ?",
      )
      .run(now, row.sessionId);
    return sessionFromRow({ ...row, lastSeenAt: now });
  }

  getSession(sessionId: string): GraftDesktopSessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT sessionId, environmentId, profile, clientId, clientLabel,
                grantsJson, createdAt, expiresAt, lastSeenAt, revokedAt
         FROM desktop_host_sessions
         WHERE sessionId = ? LIMIT 1`,
      )
      .get(sessionId) as SessionDbRow | undefined;
    return row ? sessionFromRow(row) : null;
  }

  getActiveSession(sessionId: string): GraftDesktopSessionRecord | null {
    const session = this.getSession(sessionId);
    const now = this.now();
    if (!session || session.revokedAt !== null || session.expiresAt <= now) {
      return null;
    }
    this.db
      .prepare(
        "UPDATE desktop_host_sessions SET lastSeenAt = ? WHERE sessionId = ?",
      )
      .run(now, sessionId);
    return { ...session, lastSeenAt: now };
  }

  revokeSession(sessionId: string): boolean {
    return (
      this.db
        .prepare(
          `UPDATE desktop_host_sessions
           SET revokedAt = ?
           WHERE sessionId = ? AND revokedAt IS NULL`,
        )
        .run(this.now(), sessionId).changes === 1
    );
  }

  reserveCommand(input: {
    sessionId: string;
    commandId: string;
    requestHash: string;
  }): DesktopHostCommandReservation {
    return this.db.transaction((): DesktopHostCommandReservation => {
      const existing = this.db
        .prepare(
          `SELECT sessionId, commandId, requestHash, status, resultJson,
                  errorJson, acceptedAt, completedAt
           FROM desktop_host_receipts
           WHERE sessionId = ? AND commandId = ? LIMIT 1`,
        )
        .get(input.sessionId, input.commandId) as ReceiptDbRow | undefined;
      if (existing) {
        return {
          kind:
            existing.requestHash === input.requestHash ? "replay" : "conflict",
          receipt: receiptFromRow(existing),
        };
      }

      const acceptedAt = this.now();
      this.db
        .prepare(
          `INSERT INTO desktop_host_receipts
            (sessionId, commandId, requestHash, status, resultJson, errorJson,
             acceptedAt, completedAt)
           VALUES (?, ?, ?, 'accepted', NULL, NULL, ?, NULL)`,
        )
        .run(input.sessionId, input.commandId, input.requestHash, acceptedAt);
      const receipt: DesktopHostStoredReceipt = {
        ...input,
        status: "accepted",
        acceptedAt,
        completedAt: null,
      };
      return {
        kind: "new",
        receipt,
      };
    })();
  }

  completeCommand(input: {
    sessionId: string;
    commandId: string;
    result: GraftDesktopJsonValue;
  }): DesktopHostStoredReceipt {
    const result = GraftDesktopJsonValueSchema.parse(input.result);
    const completedAt = this.now();
    const updated = this.db
      .prepare(
        `UPDATE desktop_host_receipts
         SET status = 'completed', resultJson = ?, errorJson = NULL,
             completedAt = ?
         WHERE sessionId = ? AND commandId = ? AND status = 'accepted'`,
      )
      .run(
        JSON.stringify(result),
        completedAt,
        input.sessionId,
        input.commandId,
      );
    if (updated.changes !== 1) {
      throw new Error("Desktop command receipt was not in the accepted state");
    }
    return this.requireReceipt(input.sessionId, input.commandId);
  }

  failCommand(input: {
    sessionId: string;
    commandId: string;
    error: GraftDesktopError;
  }): DesktopHostStoredReceipt {
    const error = GraftDesktopErrorSchema.parse(input.error);
    const completedAt = this.now();
    const updated = this.db
      .prepare(
        `UPDATE desktop_host_receipts
         SET status = 'failed', resultJson = NULL, errorJson = ?,
             completedAt = ?
         WHERE sessionId = ? AND commandId = ? AND status = 'accepted'`,
      )
      .run(
        JSON.stringify(error),
        completedAt,
        input.sessionId,
        input.commandId,
      );
    if (updated.changes !== 1) {
      throw new Error("Desktop command receipt was not in the accepted state");
    }
    return this.requireReceipt(input.sessionId, input.commandId);
  }

  private requireReceipt(
    sessionId: string,
    commandId: string,
  ): DesktopHostStoredReceipt {
    const row = this.db
      .prepare(
        `SELECT sessionId, commandId, requestHash, status, resultJson,
                errorJson, acceptedAt, completedAt
         FROM desktop_host_receipts
         WHERE sessionId = ? AND commandId = ? LIMIT 1`,
      )
      .get(sessionId, commandId) as ReceiptDbRow | undefined;
    if (!row) throw new Error("Desktop command receipt is missing");
    return receiptFromRow(row);
  }

  appendEvent(event: GraftDesktopJsonValue): DesktopHostStoredEvent {
    const parsed = GraftDesktopJsonValueSchema.parse(event);
    const occurredAt = this.now();
    return this.db.transaction(() => {
      const state = this.getReplayState();
      const cursor = state.cursor + 1;
      this.db
        .prepare(
          "INSERT INTO desktop_host_events (cursor, occurredAt, eventJson) VALUES (?, ?, ?)",
        )
        .run(cursor, occurredAt, JSON.stringify(parsed));
      this.db
        .prepare("UPDATE desktop_host_state SET cursor = ? WHERE singleton = 1")
        .run(cursor);
      return { cursor, occurredAt, event: parsed };
    })();
  }

  replayEvents(afterCursor: number, limit = 1_000): DesktopHostReplayResult {
    const state = this.getReplayState();
    if (afterCursor < state.replayFloor) {
      return { kind: "cursor_expired", ...state };
    }
    const rows = this.db
      .prepare(
        `SELECT cursor, occurredAt, eventJson
         FROM desktop_host_events
         WHERE cursor > ?
         ORDER BY cursor ASC
         LIMIT ?`,
      )
      .all(afterCursor, limit) as EventDbRow[];
    return {
      kind: "events",
      ...state,
      events: rows.map((row) => ({
        cursor: row.cursor,
        occurredAt: row.occurredAt,
        event: GraftDesktopJsonValueSchema.parse(parseJson(row.eventJson)),
      })),
    };
  }

  pruneEventsThrough(cursor: number): number {
    return this.db.transaction(() => {
      const state = this.getReplayState();
      const replayFloor = Math.max(
        state.replayFloor,
        Math.min(cursor, state.cursor),
      );
      this.db
        .prepare("DELETE FROM desktop_host_events WHERE cursor <= ?")
        .run(replayFloor);
      this.db
        .prepare(
          "UPDATE desktop_host_state SET replayFloor = ? WHERE singleton = 1",
        )
        .run(replayFloor);
      return replayFloor;
    })();
  }

  getReplayState(): { cursor: number; replayFloor: number } {
    return this.db
      .prepare(
        "SELECT cursor, replayFloor FROM desktop_host_state WHERE singleton = 1",
      )
      .get() as { cursor: number; replayFloor: number };
  }

  close(): void {
    this.db.close();
  }
}
