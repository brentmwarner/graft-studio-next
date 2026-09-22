import type { GraftSessionCredential } from "@graft/mobile-contract";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { decodeSessionMetadata, encodeSessionMetadata } from "./sessionCodec";

const DATABASE_NAME = "graft-mobile.db";
const TOKEN_KEY_PREFIX = "graft.remote.bearer.v1";
interface SessionRow {
  readonly environment_id: string;
  readonly metadata_json: string;
}
let databasePromise: Promise<SQLiteDatabase> | undefined;
// Serialize credential + metadata writes, including re-pair and removal of the same host.
let mutations: Promise<unknown> = Promise.resolve();
function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutations.then(operation, operation);
  mutations = result.catch(() => undefined);
  return result;
}
async function tokenKey(environmentId: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, environmentId);
  return `${TOKEN_KEY_PREFIX}.${digest}`;
}
async function database(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabaseAsync(DATABASE_NAME)
      .then(async (db) => {
        await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS active_session (
          singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
          environment_id TEXT NOT NULL, metadata_json TEXT NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS paired_sessions (
          environment_id TEXT PRIMARY KEY NOT NULL, metadata_json TEXT NOT NULL, updated_at INTEGER NOT NULL
        );
      `);
        await db.withExclusiveTransactionAsync(async (tx) => {
          await tx.runAsync(
            `INSERT OR IGNORE INTO paired_sessions SELECT environment_id, metadata_json, updated_at FROM active_session`,
          );
          await tx.runAsync("DELETE FROM active_session");
        });
        return db;
      })
      .catch((error: unknown) => {
        databasePromise = undefined;
        throw error;
      });
  }
  return databasePromise;
}
export async function loadSessions(): Promise<GraftSessionCredential[]> {
  await mutations;
  const db = await database();
  const rows = await db.getAllAsync<SessionRow>(
    "SELECT environment_id, metadata_json FROM paired_sessions ORDER BY updated_at DESC",
  );
  const sessions = await Promise.all(
    rows.map(async (row) => {
      const bearer = await SecureStore.getItemAsync(await tokenKey(row.environment_id));
      if (!bearer) return null;
      try {
        return decodeSessionMetadata(row.metadata_json, bearer);
      } catch {
        return null;
      }
    }),
  );
  return sessions.filter((session): session is GraftSessionCredential => session !== null);
}
export async function loadSession(): Promise<GraftSessionCredential | null> {
  return (await loadSessions())[0] ?? null;
}
export function saveSession(session: GraftSessionCredential): Promise<void> {
  return mutate(async () => {
    const db = await database();
    const key = await tokenKey(session.environmentId);
    const previousToken = await SecureStore.getItemAsync(key);
    await SecureStore.setItemAsync(key, session.bearerToken);
    try {
      await db.runAsync(
        `INSERT INTO paired_sessions (environment_id, metadata_json, updated_at)
        VALUES (?, ?, ?) ON CONFLICT(environment_id) DO UPDATE SET metadata_json = excluded.metadata_json, updated_at = excluded.updated_at`,
        session.environmentId,
        encodeSessionMetadata(session),
        Date.now(),
      );
    } catch (error) {
      if (previousToken) await SecureStore.setItemAsync(key, previousToken);
      else await SecureStore.deleteItemAsync(key);
      throw error;
    }
  });
}
export function clearSession(environmentId: string, sessionId?: string): Promise<void> {
  return mutate(async () => {
    const db = await database();
    const result = sessionId
      ? await db.runAsync(
          "DELETE FROM paired_sessions WHERE environment_id = ? AND json_extract(metadata_json, '$.sessionId') = ?",
          environmentId,
          sessionId,
        )
      : await db.runAsync("DELETE FROM paired_sessions WHERE environment_id = ?", environmentId);
    // A late revocation/removal from the old socket must not remove a new pairing.
    if (result.changes > 0) await SecureStore.deleteItemAsync(await tokenKey(environmentId));
  });
}
