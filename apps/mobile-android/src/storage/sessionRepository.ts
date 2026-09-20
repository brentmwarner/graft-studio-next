import type { GraftSessionCredential } from "@graft/mobile-contract";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { decodeSessionMetadata, encodeSessionMetadata } from "./sessionCodec";

const DATABASE_NAME = "graft-mobile.db";
const POINTER_ROW_ID = 1;
const TOKEN_KEY_PREFIX = "graft.remote.bearer.v1";

interface SessionRow {
  readonly environment_id: string;
  readonly metadata_json: string;
}

let databasePromise: Promise<SQLiteDatabase> | undefined;

async function tokenKey(environmentId: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, environmentId);
  return `${TOKEN_KEY_PREFIX}.${digest}`;
}

async function database(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabaseAsync(DATABASE_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS active_session (
          singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
          environment_id TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS paired_sessions (
          environment_id TEXT PRIMARY KEY NOT NULL,
          metadata_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS active_session_pointer (
          singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
          environment_id TEXT NOT NULL
        );
        INSERT OR IGNORE INTO paired_sessions (environment_id, metadata_json, updated_at)
          SELECT environment_id, metadata_json, updated_at FROM active_session;
        INSERT OR IGNORE INTO active_session_pointer (singleton, environment_id)
          SELECT 1, environment_id FROM active_session;
      `);
      return db;
    });
  }
  return databasePromise;
}

async function decodeRow(row: SessionRow): Promise<GraftSessionCredential | null> {
  const key = await tokenKey(row.environment_id);
  const bearerToken = await SecureStore.getItemAsync(key);
  if (!bearerToken) return null;
  try {
    return decodeSessionMetadata(row.metadata_json, bearerToken);
  } catch {
    await SecureStore.deleteItemAsync(key);
    return null;
  }
}

async function writePointer(db: SQLiteDatabase, environmentId: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO active_session_pointer (singleton, environment_id)
     VALUES (?, ?)
     ON CONFLICT(singleton) DO UPDATE SET environment_id = excluded.environment_id`,
    POINTER_ROW_ID,
    environmentId,
  );
}

export async function listSessions(): Promise<GraftSessionCredential[]> {
  const db = await database();
  const rows = await db.getAllAsync<SessionRow>(
    "SELECT environment_id, metadata_json FROM paired_sessions ORDER BY updated_at DESC",
  );
  const sessions: GraftSessionCredential[] = [];
  for (const row of rows) {
    const session = await decodeRow(row);
    if (session) sessions.push(session);
    else {
      await db.runAsync("DELETE FROM paired_sessions WHERE environment_id = ?", row.environment_id);
    }
  }
  return sessions;
}

export async function loadSession(): Promise<GraftSessionCredential | null> {
  const db = await database();
  const pointer = await db.getFirstAsync<{ environment_id: string }>(
    "SELECT environment_id FROM active_session_pointer WHERE singleton = ?",
    POINTER_ROW_ID,
  );
  if (pointer) {
    const row = await db.getFirstAsync<SessionRow>(
      "SELECT environment_id, metadata_json FROM paired_sessions WHERE environment_id = ?",
      pointer.environment_id,
    );
    if (row) {
      const session = await decodeRow(row);
      if (session) return session;
      await db.runAsync("DELETE FROM paired_sessions WHERE environment_id = ?", row.environment_id);
    }
  }
  const sessions = await listSessions();
  if (sessions[0]) {
    await writePointer(db, sessions[0].environmentId);
    return sessions[0];
  }
  await db.runAsync("DELETE FROM active_session_pointer WHERE singleton = ?", POINTER_ROW_ID);
  return null;
}

export async function saveSession(session: GraftSessionCredential): Promise<void> {
  const db = await database();
  const key = await tokenKey(session.environmentId);
  const previousToken = await SecureStore.getItemAsync(key);
  await SecureStore.setItemAsync(key, session.bearerToken);

  try {
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO paired_sessions (environment_id, metadata_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(environment_id) DO UPDATE SET
           metadata_json = excluded.metadata_json,
           updated_at = excluded.updated_at`,
        session.environmentId,
        encodeSessionMetadata(session),
        Date.now(),
      );
      await transaction.runAsync(
        `INSERT INTO active_session_pointer (singleton, environment_id)
         VALUES (?, ?)
         ON CONFLICT(singleton) DO UPDATE SET environment_id = excluded.environment_id`,
        POINTER_ROW_ID,
        session.environmentId,
      );
    });
  } catch (error) {
    if (previousToken) {
      await SecureStore.setItemAsync(key, previousToken);
    } else {
      await SecureStore.deleteItemAsync(key);
    }
    throw error;
  }
}

export async function activateSession(
  environmentId: string,
): Promise<GraftSessionCredential | null> {
  const db = await database();
  const row = await db.getFirstAsync<SessionRow>(
    "SELECT environment_id, metadata_json FROM paired_sessions WHERE environment_id = ?",
    environmentId,
  );
  if (!row) return null;
  const session = await decodeRow(row);
  if (!session) {
    await db.runAsync("DELETE FROM paired_sessions WHERE environment_id = ?", environmentId);
    return loadSession();
  }
  await db.runAsync(
    "UPDATE paired_sessions SET updated_at = ? WHERE environment_id = ?",
    Date.now(),
    environmentId,
  );
  await writePointer(db, environmentId);
  return session;
}

export async function removeSession(
  environmentId: string,
): Promise<GraftSessionCredential | null> {
  const db = await database();
  await SecureStore.deleteItemAsync(await tokenKey(environmentId));
  await db.runAsync("DELETE FROM paired_sessions WHERE environment_id = ?", environmentId);
  const pointer = await db.getFirstAsync<{ environment_id: string }>(
    "SELECT environment_id FROM active_session_pointer WHERE singleton = ?",
    POINTER_ROW_ID,
  );
  if (pointer?.environment_id === environmentId) {
    await db.runAsync("DELETE FROM active_session_pointer WHERE singleton = ?", POINTER_ROW_ID);
  }
  return loadSession();
}

export async function clearSession(): Promise<void> {
  const sessions = await listSessions();
  await Promise.all(sessions.map((session) => removeSession(session.environmentId)));
}

export function resetSessionRepositoryForTests(): void {
  databasePromise = undefined;
}
