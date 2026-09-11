import type { GraftSessionCredential } from "@graft/mobile-contract";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { decodeSessionMetadata, encodeSessionMetadata } from "./sessionCodec";

const DATABASE_NAME = "graft-mobile.db";
const SESSION_ROW_ID = 1;
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
      `);
      return db;
    });
  }
  return databasePromise;
}

export async function loadSession(): Promise<GraftSessionCredential | null> {
  const db = await database();
  const row = await db.getFirstAsync<SessionRow>(
    "SELECT environment_id, metadata_json FROM active_session WHERE singleton = ?",
    SESSION_ROW_ID,
  );
  if (!row) return null;

  const key = await tokenKey(row.environment_id);
  const bearerToken = await SecureStore.getItemAsync(key);
  if (!bearerToken) {
    await db.runAsync("DELETE FROM active_session WHERE singleton = ?", SESSION_ROW_ID);
    return null;
  }

  try {
    return decodeSessionMetadata(row.metadata_json, bearerToken);
  } catch {
    await Promise.all([
      db.runAsync("DELETE FROM active_session WHERE singleton = ?", SESSION_ROW_ID),
      SecureStore.deleteItemAsync(key),
    ]);
    return null;
  }
}

export async function saveSession(session: GraftSessionCredential): Promise<void> {
  const db = await database();
  const key = await tokenKey(session.environmentId);
  const prior = await db.getFirstAsync<SessionRow>(
    "SELECT environment_id, metadata_json FROM active_session WHERE singleton = ?",
    SESSION_ROW_ID,
  );
  const previousToken = await SecureStore.getItemAsync(key);
  await SecureStore.setItemAsync(key, session.bearerToken);

  try {
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO active_session
          (singleton, environment_id, metadata_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET
          environment_id = excluded.environment_id,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at`,
        SESSION_ROW_ID,
        session.environmentId,
        encodeSessionMetadata(session),
        Date.now(),
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

  if (prior && prior.environment_id !== session.environmentId) {
    await SecureStore.deleteItemAsync(await tokenKey(prior.environment_id));
  }
}

export async function clearSession(): Promise<void> {
  const db = await database();
  const row = await db.getFirstAsync<SessionRow>(
    "SELECT environment_id, metadata_json FROM active_session WHERE singleton = ?",
    SESSION_ROW_ID,
  );
  if (row) {
    await SecureStore.deleteItemAsync(await tokenKey(row.environment_id));
  }
  await db.runAsync("DELETE FROM active_session WHERE singleton = ?", SESSION_ROW_ID);
}
