import { DatabaseSync } from "node:sqlite";
import type { GraftSessionCredential } from "@graft/mobile-contract";
import { beforeAll, expect, it, vi } from "vitest";
import { clearSession, loadSessions, saveSession } from "./sessionRepository";
import { encodeSessionMetadata } from "./sessionCodec";

const mock = vi.hoisted(() => ({
  db: undefined as unknown as DatabaseSync,
  tokens: new Map<string, string>(),
  failWrite: false,
}));
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "sha256" },
  digestStringAsync: async (_algorithm: string, value: string) => value,
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => mock.tokens.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mock.tokens.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mock.tokens.delete(key);
  },
}));
vi.mock("expo-sqlite", () => {
  const db = {
    execAsync: async (sql: string) => {
      mock.db.exec(sql);
    },
    runAsync: async (sql: string, ...args: (string | number)[]) => {
      if (mock.failWrite && sql.startsWith("INSERT INTO")) {
        mock.failWrite = false;
        throw new Error("disk full");
      }
      return mock.db.prepare(sql).run(...args);
    },
    getAllAsync: async (sql: string) => mock.db.prepare(sql).all(),
    withExclusiveTransactionAsync: async (body: (transaction: unknown) => Promise<void>) => {
      mock.db.exec("BEGIN");
      try {
        await body(db);
        mock.db.exec("COMMIT");
      } catch (error) {
        mock.db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { openDatabaseAsync: async () => db };
});
const session = (id: string, token = `bearer-token-${id}-12345678`): GraftSessionCredential => ({
  environmentId: id,
  environmentLabel: id,
  sessionId: `session-${id}`,
  deviceId: "device-12345678",
  bearerToken: token,
  protocolVersion: 1,
  capabilities: ["projects"],
  httpBaseUrl: "https://host.test",
  wsBaseUrl: "wss://host.test",
  expiresAt: null,
});
beforeAll(() => {
  mock.db = new DatabaseSync(":memory:");
  mock.db.exec(
    "CREATE TABLE active_session (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), environment_id TEXT NOT NULL, metadata_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  );
  mock.db
    .prepare("INSERT INTO active_session VALUES (1, ?, ?, 1)")
    .run("legacy", encodeSessionMetadata(session("legacy")));
  mock.tokens.set("graft.remote.bearer.v1.legacy", session("legacy").bearerToken);
});
it("migrates the existing pairing without changing its secure credential", async () => {
  expect(await loadSessions()).toEqual([session("legacy")]);
  expect(mock.db.prepare("SELECT * FROM active_session").all()).toEqual([]);
  expect(mock.tokens.get("graft.remote.bearer.v1.legacy")).toBe(session("legacy").bearerToken);
});
it("adds and re-pairs computers without deleting any other pairing or token", async () => {
  await saveSession(session("a"));
  await saveSession(session("b"));
  await saveSession(session("a", "replacement-token-12345678"));
  const sessions = await loadSessions();
  expect(sessions).toHaveLength(3);
  expect(sessions.find((item) => item.environmentId === "b")).toEqual(session("b"));
  expect(sessions.find((item) => item.environmentId === "a")?.bearerToken).toBe(
    "replacement-token-12345678",
  );
  expect(
    mock.db
      .prepare("SELECT metadata_json FROM paired_sessions")
      .all()
      .some((row) => String(row.metadata_json).includes("bearerToken")),
  ).toBe(false);
});
it("restores the previous credential when metadata persistence fails", async () => {
  mock.failWrite = true;
  await expect(saveSession(session("b", "wrong-token-12345678"))).rejects.toThrow("disk full");
  expect((await loadSessions()).find((item) => item.environmentId === "b")).toEqual(session("b"));
});
it("removes only the requested computer", async () => {
  await clearSession("a");
  expect((await loadSessions()).map((item) => item.environmentId).sort()).toEqual(["b", "legacy"]);
  expect(mock.tokens.has("graft.remote.bearer.v1.a")).toBe(false);
  expect(mock.tokens.has("graft.remote.bearer.v1.b")).toBe(true);
});

it("ignores an old session's removal after the same computer is paired again", async () => {
  const replacement = {
    ...session("b", "new-secure-token-12345678"),
    sessionId: "replacement-session",
  };
  await saveSession(replacement);
  await clearSession("b", "session-b");
  expect((await loadSessions()).find((item) => item.environmentId === "b")).toEqual(replacement);
  await clearSession("b", replacement.sessionId);
  expect((await loadSessions()).some((item) => item.environmentId === "b")).toBe(false);
  expect(mock.tokens.has("graft.remote.bearer.v1.b")).toBe(false);
});
