import type { GraftEnvironmentSnapshot } from "@graft/mobile-contract";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

import { useInboxReadState } from "./useInboxReadState";
import type { ThreadReadState } from "./threadActivity";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mock = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  foreground: true,
  listener: (_state: string) => {},
}));
vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItemSync: (key: string) => mock.storage.get(key) ?? null,
    setItemSync: (key: string, value: string) => mock.storage.set(key, value),
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return mock.foreground ? "active" : "background";
    },
    addEventListener: (_name: string, listener: (state: string) => void) => {
      mock.listener = listener;
      return { remove: () => {} };
    },
  },
}));
const snapshot: GraftEnvironmentSnapshot = {
  environment: {
    id: "a",
    label: "Mac",
    hostVersion: "1",
    protocolVersion: 1,
    capabilities: [],
    cursor: 1,
  },
  projects: [],
  threads: [{ id: "t", projectId: "p", title: "Reply", updatedAt: 100, lastCompletedAt: 100 }],
  activeRuns: [],
  pendingApprovals: [],
  pendingQuestions: [],
  selectedTranscript: null,
  cursor: 1,
};
let reads: ThreadReadState;
let renderer: ReactTestRenderer;
function Harness({ env = "a", loaded = false }: { env?: string; loaded?: boolean }) {
  reads = useInboxReadState(
    env,
    { ...snapshot, selectedTranscript: loaded ? { threadId: "t", cursor: 1, events: [] } : null },
    [],
    "t",
  );
  return null;
}
afterEach(async () => {
  await act(async () => renderer?.unmount());
  mock.storage.clear();
  mock.foreground = true;
});
it("requires a loaded foreground transcript, persists reads, and isolates computers", async () => {
  mock.foreground = false;
  await act(async () => {
    renderer = create(createElement(Harness, { loaded: true }));
  });
  expect(reads.t?.viewedAt).toBe(0);
  await act(async () => {
    renderer.update(createElement(Harness));
    mock.listener("active");
  });
  expect(reads.t?.viewedAt).toBe(0);
  await act(async () => renderer.update(createElement(Harness, { loaded: true })));
  expect(reads.t?.viewedAt).toBe(100);
  expect(JSON.parse(mock.storage.get("inbox.reads.a")!).t.viewedAt).toBe(100);
  await act(async () => renderer.update(createElement(Harness, { env: "b" })));
  expect(reads.t?.viewedAt).toBe(0);
  await act(async () => renderer.update(createElement(Harness, { env: "a" })));
  expect(reads.t?.viewedAt).toBe(100);
});
