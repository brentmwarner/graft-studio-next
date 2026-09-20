import type { GraftEnvironmentSnapshot } from "@graft/mobile-contract";
import { beforeEach, expect, it, vi } from "vitest";
import { loadCachedSnapshot, saveCachedSnapshot } from "./snapshotCache";

const memory = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItemSync: (key: string) => memory.get(key) ?? null,
    setItemSync: (key: string, value: string) => memory.set(key, value),
    removeItemSync: (key: string) => memory.delete(key),
  },
}));
const snapshot = (id: string, threadId = "same-thread"): GraftEnvironmentSnapshot => ({
  environment: {
    id,
    label: id,
    hostVersion: "1",
    protocolVersion: 1,
    capabilities: ["projects"],
    cursor: 1,
  },
  projects: [],
  threads: [],
  activeRuns: [],
  pendingApprovals: [],
  pendingQuestions: [],
  cursor: 1,
  selectedTranscript: {
    threadId,
    cursor: 1,
    events: [
      { id: "answer", cursor: 1, createdAt: 1, kind: "assistant.message", threadId, text: id },
    ],
  },
});
beforeEach(() => memory.clear());
it("restores the right computer's transcript for colliding thread IDs", () => {
  saveCachedSnapshot(snapshot("a"));
  saveCachedSnapshot(snapshot("b"));
  expect(loadCachedSnapshot("a", "same-thread")?.selectedTranscript?.events[0]?.text).toBe("a");
  expect(loadCachedSnapshot("b", "same-thread")?.selectedTranscript?.events[0]?.text).toBe("b");
  expect(loadCachedSnapshot("a")?.selectedTranscript).toBeNull();
  expect(loadCachedSnapshot("a", "unseen")?.selectedTranscript).toBeNull();
});
it("bounds transcript storage without deleting another computer's history", () => {
  saveCachedSnapshot(snapshot("b"));
  for (let index = 0; index < 51; index++) saveCachedSnapshot(snapshot("a", `t${index}`));
  expect(loadCachedSnapshot("a", "t0")?.selectedTranscript).toBeNull();
  expect(loadCachedSnapshot("a", "t50")?.selectedTranscript?.threadId).toBe("t50");
  expect(loadCachedSnapshot("b", "same-thread")?.selectedTranscript).not.toBeNull();
});
it("rejects mismatched environments and corrupt caches", () => {
  memory.set("inbox.snapshot.a", JSON.stringify(snapshot("b")));
  expect(loadCachedSnapshot("a")).toBeNull();
  memory.set("inbox.snapshot.a", "{");
  expect(loadCachedSnapshot("a")).toBeNull();
});
