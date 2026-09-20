import { GRAFT_MOBILE_PROTOCOL_VERSION, type GraftSessionCredential } from "@graft/mobile-contract";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type SessionRow = {
  environment_id: string;
  metadata_json: string;
  updated_at: number;
};

const mock = vi.hoisted(() => {
  function bindValues(params: unknown[]): unknown[] {
    return params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  }

  const tokens = new Map<string, string>();
  const paired = new Map<string, SessionRow>();
  const state = {
    tokens,
    paired,
    pointer: undefined as string | undefined,
    legacy: undefined as SessionRow | undefined,
  };

  const db: {
    execAsync: () => Promise<void>;
    getAllAsync: (sql: string) => Promise<SessionRow[]>;
    getFirstAsync: (sql: string, ...params: unknown[]) => Promise<unknown>;
    runAsync: (sql: string, ...params: unknown[]) => Promise<void>;
    withExclusiveTransactionAsync: (
      work: (transaction: { runAsync: (sql: string, ...params: unknown[]) => Promise<void> }) => Promise<void>,
    ) => Promise<void>;
  } = {
    execAsync: async () => {
      if (state.legacy && state.paired.size === 0) {
        state.paired.set(state.legacy.environment_id, state.legacy);
        state.pointer = state.legacy.environment_id;
      }
    },
    getAllAsync: async (sql: string) => {
      if (sql.includes("FROM paired_sessions")) {
        return [...state.paired.values()].sort((left, right) => right.updated_at - left.updated_at);
      }
      return [];
    },
    getFirstAsync: async (sql: string, ...params: unknown[]) => {
      const values = bindValues(params);
      if (sql.includes("FROM active_session_pointer")) {
        return state.pointer ? { environment_id: state.pointer } : null;
      }
      if (sql.includes("FROM paired_sessions")) {
        return state.paired.get(String(values[0])) ?? null;
      }
      return null;
    },
    runAsync: async (sql: string, ...params: unknown[]) => {
      const values = bindValues(params);
      if (sql.includes("DELETE FROM paired_sessions")) {
        state.paired.delete(String(values[0]));
        return;
      }
      if (sql.includes("DELETE FROM active_session_pointer")) {
        state.pointer = undefined;
        return;
      }
      if (sql.includes("UPDATE paired_sessions SET updated_at")) {
        const row = state.paired.get(String(values[1]));
        if (row) row.updated_at = Number(values[0]);
        return;
      }
      if (sql.includes("INSERT INTO paired_sessions")) {
        state.paired.set(String(values[0]), {
          environment_id: String(values[0]),
          metadata_json: String(values[1]),
          updated_at: Number(values[2]),
        });
        return;
      }
      if (sql.includes("INSERT INTO active_session_pointer")) {
        state.pointer = String(values[1]);
      }
    },
    withExclusiveTransactionAsync: async (
      work: (transaction: { runAsync: (sql: string, ...params: unknown[]) => Promise<void> }) => Promise<void>,
    ) => {
      await work(db);
    },
  };

  return { state, db };
});

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async (_algorithm: string, value: string) => `hash-${value}`,
}));

vi.mock("expo-secure-store", () => ({
  deleteItemAsync: async (key: string) => {
    mock.state.tokens.delete(key);
  },
  getItemAsync: async (key: string) => mock.state.tokens.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mock.state.tokens.set(key, value);
  },
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async () => mock.db,
}));

import {
  activateSession,
  listSessions,
  loadSession,
  removeSession,
  resetSessionRepositoryForTests,
  saveSession,
} from "./sessionRepository";

function credential(environmentId: string, label: string): GraftSessionCredential {
  return {
    sessionId: `session-${environmentId}`,
    deviceId: "device-12345678",
    bearerToken: `super-secret-bearer-${environmentId}`,
    environmentId,
    environmentLabel: label,
    httpBaseUrl: `http://${environmentId}.example:47321`,
    wsBaseUrl: `ws://${environmentId}.example:47321`,
    protocolVersion: GRAFT_MOBILE_PROTOCOL_VERSION,
    capabilities: ["projects"],
    expiresAt: null,
  };
}

beforeEach(() => {
  mock.state.tokens.clear();
  mock.state.paired.clear();
  mock.state.pointer = undefined;
  mock.state.legacy = undefined;
  resetSessionRepositoryForTests();
});

afterEach(() => {
  resetSessionRepositoryForTests();
});

it("keeps multiple paired computers and restores the active one", async () => {
  const mac = credential("mac", "Mac");
  const studio = credential("studio", "Studio");
  await saveSession(mac);
  await saveSession(studio);
  expect((await listSessions()).map((session) => session.environmentId).sort()).toEqual([
    "mac",
    "studio",
  ]);
  expect((await loadSession())?.environmentId).toBe("studio");
  expect(await activateSession("mac")).toMatchObject({
    environmentId: "mac",
    bearerToken: "super-secret-bearer-mac",
  });
  expect((await loadSession())?.environmentLabel).toBe("Mac");
  expect((await listSessions())[0]?.environmentId).toBe("mac");
});

it("removes one computer without dropping the other", async () => {
  await saveSession(credential("mac", "Mac"));
  await saveSession(credential("studio", "Studio"));
  const remaining = await removeSession("studio");
  expect(remaining?.environmentId).toBe("mac");
  expect(await listSessions()).toHaveLength(1);
  expect(mock.state.tokens.has("graft.remote.bearer.v1.hash-studio")).toBe(false);
  expect(mock.state.tokens.get("graft.remote.bearer.v1.hash-mac")).toBe(
    "super-secret-bearer-mac",
  );
});

it("migrates a legacy singleton pairing into the session list", async () => {
  const { encodeSessionMetadata } = await import("./sessionCodec");
  const mac = credential("mac", "Mac");
  mock.state.legacy = {
    environment_id: "mac",
    metadata_json: encodeSessionMetadata(mac),
    updated_at: 1,
  };
  mock.state.tokens.set("graft.remote.bearer.v1.hash-mac", mac.bearerToken);
  expect((await loadSession())?.environmentId).toBe("mac");
  expect(await listSessions()).toHaveLength(1);
});
