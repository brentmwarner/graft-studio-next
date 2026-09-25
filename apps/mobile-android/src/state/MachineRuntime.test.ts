import type { GraftEnvironmentSnapshot, GraftSessionCredential } from "@graft/mobile-contract";
import { createElement, useCallback, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MachineRuntime, type MachineController } from "./MachineRuntime";
import { GatewayError } from "../api/gateway";
import type { GatewaySocketHandlers } from "../api/gatewaySocket";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mock = vi.hoisted(() => ({
  sockets: [] as {
    credential?: GraftSessionCredential;
    handlers: GatewaySocketHandlers;
    disconnect: ReturnType<typeof vi.fn>;
    command: ReturnType<typeof vi.fn>;
  }[],
  snapshot: vi.fn(),
  clearSession: vi.fn(),
  storage: new Map<string, string>(),
}));
vi.mock("expo-application", () => ({ nativeApplicationVersion: "1" }));
vi.mock("expo-device", () => ({ deviceName: "Phone" }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "command-1" }));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItemSync: (key: string) => mock.storage.get(key) ?? null,
    setItemSync: (key: string, value: string) => mock.storage.set(key, value),
    removeItemSync: (key: string) => mock.storage.delete(key),
  },
}));
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock("../api/gatewayNetwork", () => ({ watchGatewayNetwork: () => () => {} }));
vi.mock("../storage/deviceIdentity", () => ({ getDeviceIdentity: async () => "device-12345678" }));
vi.mock("../storage/sessionRepository", () => ({
  loadSession: async () => null,
  saveSession: vi.fn(),
  clearSession: mock.clearSession,
}));
vi.mock("../screens/thread/composerAttachmentSend", () => ({ sendWithAttachments: vi.fn() }));
vi.mock("../api/gateway", () => ({
  GatewayError: class extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  },
  createGatewayClient: () => ({ snapshot: mock.snapshot }),
}));
vi.mock("../api/gatewaySocket", () => ({
  GatewaySocketError: class extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  },
  GatewaySocket: class {
    credential?: GraftSessionCredential;
    disconnect = vi.fn();
    updateCursor = vi.fn();
    command = vi.fn(async () => ({
      type: "thread.create.result",
      thread: {
        id: "created",
        projectId: "p",
        title: this.credential?.environmentId,
        updatedAt: 1,
      },
    }));
    constructor(readonly handlers: GatewaySocketHandlers) {
      mock.sockets.push(this);
    }
    connect(credential: GraftSessionCredential) {
      this.credential = credential;
      this.handlers.onStateChange("connecting");
    }
  },
}));
const credential = (id: string): GraftSessionCredential => ({
  environmentId: id,
  environmentLabel: id,
  sessionId: `session-${id}`,
  deviceId: "device-12345678",
  bearerToken: "bearer-12345678",
  protocolVersion: 1,
  capabilities: ["projects"],
  httpBaseUrl: "https://host.test",
  wsBaseUrl: "wss://host.test",
  expiresAt: null,
});
const a = credential("a");
const b = credential("b");
const snapshot = (id: string, threadId?: string): GraftEnvironmentSnapshot => ({
  environment: {
    id,
    label: id,
    hostVersion: "1",
    protocolVersion: 1,
    capabilities: ["projects"],
    cursor: 1,
  },
  projects: [{ id: "p", name: "Project", kind: "repo" }],
  threads: [{ id: "same", projectId: "p", title: id, updatedAt: 1 }],
  activeRuns: [],
  pendingApprovals: [],
  pendingQuestions: [],
  cursor: 1,
  selectedTranscript: threadId
    ? {
        threadId,
        cursor: 1,
        events: [
          { id: "reply", cursor: 1, kind: "assistant.message", createdAt: 1, threadId, text: id },
        ],
      }
    : null,
});
let published: Readonly<Record<string, MachineController>> = {};
let renderer: ReactTestRenderer;
function Harness({ credentials }: { credentials: readonly GraftSessionCredential[] }) {
  const [controllers, setControllers] = useState<Readonly<Record<string, MachineController>>>({});
  published = controllers;
  const update = useCallback(
    (session: GraftSessionCredential, controller: MachineController) =>
      setControllers((current) => ({ ...current, [session.environmentId]: controller })),
    [],
  );
  return credentials.map((session) =>
    createElement(MachineRuntime, {
      key: session.sessionId,
      credential: session,
      onUpdate: update,
    }),
  );
}
async function connect(index: number) {
  await act(async () => {
    const socket = mock.sockets[index]!;
    socket.handlers.onStateChange("connected");
    socket.handlers.onMessage({
      envelope: "welcome",
      protocolVersion: 1,
      capabilities: ["projects"],
      environmentId: socket.credential!.environmentId,
      environmentLabel: "Studio",
      cursor: 1,
    });
    await vi.advanceTimersByTimeAsync(0);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  mock.sockets = [];
  mock.storage.clear();
  mock.clearSession.mockReset().mockResolvedValue(undefined);
  mock.snapshot
    .mockReset()
    .mockImplementation(async (session: GraftSessionCredential, threadId?: string) =>
      snapshot(session.environmentId, threadId),
    );
});

it("refreshes generated titles while tokens keep arriving", async () => {
  await act(async () => {
    renderer = create(createElement(Harness, { credentials: [a] }));
  });
  await connect(0);
  mock.snapshot.mockImplementation(async () => ({
    ...snapshot("a"),
    cursor: 20,
    threads: [{ id: "same", projectId: "p", title: "Fix mobile skills", updatedAt: 2 }],
  }));
  const initialCalls = mock.snapshot.mock.calls.length;
  for (let cursor = 2; cursor <= 9; cursor++) {
    await act(async () => {
      mock.sockets[0]!.handlers.onMessage({
        envelope: "event",
        event: {
          id: "reply",
          cursor,
          threadId: "same",
          kind: "assistant.delta",
          text: "Still streaming",
          createdAt: cursor,
        },
      });
      await vi.advanceTimersByTimeAsync(50);
    });
  }
  expect(mock.snapshot.mock.calls.length).toBeGreaterThan(initialCalls);
  const state = published.a!.state;
  expect(state.status === "paired" && state.snapshot?.threads[0]?.title).toBe("Fix mobile skills");
});

it("lets a slow snapshot finish and then reconciles events received during the request", async () => {
  await act(async () => {
    renderer = create(createElement(Harness, { credentials: [a] }));
  });
  await connect(0);
  let finish!: (value: GraftEnvironmentSnapshot) => void;
  mock.snapshot.mockImplementationOnce(
    () =>
      new Promise<GraftEnvironmentSnapshot>((resolve) => {
        finish = resolve;
      }),
  );
  const emit = (cursor: number) =>
    mock.sockets[0]!.handlers.onMessage({
      envelope: "event",
      event: {
        id: "reply",
        cursor,
        threadId: "same",
        kind: "assistant.delta",
        text: "Still streaming",
        createdAt: cursor,
      },
    });
  const initialCalls = mock.snapshot.mock.calls.length;
  await act(async () => {
    emit(2);
    await vi.advanceTimersByTimeAsync(250);
  });
  for (let cursor = 3; cursor <= 10; cursor++) {
    await act(async () => {
      emit(cursor);
      await vi.advanceTimersByTimeAsync(50);
    });
  }
  expect(mock.snapshot.mock.calls.length).toBe(initialCalls + 1);
  await act(async () => {
    finish({ ...snapshot("a"), cursor: 2 });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(mock.snapshot.mock.calls.length).toBe(initialCalls + 2);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.useRealTimers();
});
it("keeps two live runtimes mounted through parent updates and sends commands to the owner", async () => {
  await act(async () => {
    renderer = create(createElement(Harness, { credentials: [a, b] }));
  });
  await connect(0);
  await connect(1);
  expect(mock.sockets).toHaveLength(2);
  expect(published.a?.state.status).toBe("paired");
  expect(published.b?.state.status).toBe("paired");
  await act(async () => {
    await published.b!.createThread("p");
  });
  expect(mock.sockets[1]!.command).toHaveBeenCalledWith(
    expect.objectContaining({ type: "thread.create", projectId: "p" }),
    undefined,
  );
  expect(mock.sockets[0]!.command).not.toHaveBeenCalled();
  await act(async () => renderer.update(createElement(Harness, { credentials: [b] })));
  expect(mock.sockets[0]!.disconnect).toHaveBeenCalledOnce();
  expect(mock.sockets[1]!.disconnect).not.toHaveBeenCalled();
  expect(mock.sockets).toHaveLength(2);
});
it("sends inbox actions only to the owning computer and propagates failures", async () => {
  await act(async () => {
    renderer = create(createElement(Harness, { credentials: [a, b] }));
  });
  await connect(0);
  await connect(1);
  mock.sockets[1]!.command.mockResolvedValueOnce({ type: "thread.archive.result", threadId: "t" });
  await act(async () => {
    await published.b!.manageThread("t", "archive");
  });
  expect(mock.sockets[1]!.command).toHaveBeenCalledWith(
    { type: "thread.archive", threadId: "t" },
    undefined,
  );
  expect(mock.sockets[0]!.command).not.toHaveBeenCalled();
  mock.sockets[1]!.command.mockRejectedValueOnce(new Error("Computer disconnected"));
  await act(async () => {
    await expect(published.b!.manageThread("t", "delete")).rejects.toThrow("Computer disconnected");
  });
});

it("preserves cached history while offline and recovers only that computer", async () => {
  await act(async () => {
    renderer = create(createElement(Harness, { credentials: [a, b] }));
  });
  await connect(0);
  await connect(1);
  await act(async () => {
    await published.a!.openThread("same");
    await published.b!.openThread("same");
  });
  await act(async () => mock.sockets[0]!.handlers.onStateChange("reconnecting"));
  mock.snapshot.mockClear();
  await act(async () => {
    await published.a!.openThread("same");
  });
  expect(mock.snapshot).not.toHaveBeenCalled();
  const offline = published.a!.state;
  expect(offline.status === "paired" && offline.snapshot?.selectedTranscript?.events[0]?.text).toBe(
    "a",
  );
  expect(offline.status === "paired" && offline.error).toBeUndefined();
  expect(published.b!.state.status === "paired" && published.b!.state.connectionState).toBe(
    "connected",
  );
  await connect(0);
  expect(mock.snapshot).toHaveBeenCalledWith(a, "same");
  await act(async () => {
    await published.a!.unpair();
  });
  expect(mock.clearSession).toHaveBeenCalledWith("a", a.sessionId);
  expect(mock.sockets[1]!.disconnect).not.toHaveBeenCalled();
});
it("keeps sleeping machines quiet but surfaces auth and invalid-response errors", async () => {
  mock.snapshot.mockRejectedValue(new GatewayError("Offline", "host_offline"));
  await act(async () => {
    renderer = create(createElement(Harness, { credentials: [a] }));
  });
  expect(published.a!.state.status === "paired" && published.a!.state.error).toBeUndefined();
  mock.snapshot.mockRejectedValue(
    new GatewayError("Pairing was rejected", "authentication_required"),
  );
  await act(async () => {
    await published.a!.refresh();
  });
  expect(published.a!.state.status === "paired" && published.a!.state.error).toBe(
    "Pairing was rejected",
  );
  mock.snapshot.mockResolvedValue(snapshot("wrong-computer"));
  await act(async () => {
    await published.a!.refresh();
  });
  expect(published.a!.state.status === "paired" && published.a!.state.error).toBe(
    "Snapshot belongs to another computer.",
  );
});

it("restores an offline computer after remount without borrowing the other cache", async () => {
  await act(async () => {
    renderer = create(createElement(Harness, { credentials: [a, b] }));
  });
  await connect(0);
  await connect(1);
  await act(async () => {
    await published.a!.openThread("same");
    await published.b!.openThread("same");
  });
  await act(async () => renderer.unmount());
  mock.snapshot.mockRejectedValue(new GatewayError("Offline", "network"));
  await act(async () => {
    renderer = create(createElement(Harness, { credentials: [a, b] }));
  });
  await act(async () => {
    await published.b!.openThread("same");
  });
  const restored = published.b!.state;
  expect(
    restored.status === "paired" && restored.snapshot?.selectedTranscript?.events[0]?.text,
  ).toBe("b");
  expect(restored.status === "paired" && restored.isRefreshing).toBe(false);
  expect(restored.status === "paired" && restored.error).toBeUndefined();
});
it("ignores a removed session's late snapshot after re-pairing the same machine", async () => {
  let resolveOld: (value: GraftEnvironmentSnapshot) => void = () => {};
  mock.snapshot.mockImplementationOnce(
    () =>
      new Promise<GraftEnvironmentSnapshot>((resolve) => {
        resolveOld = resolve;
      }),
  );
  await act(async () => {
    renderer = create(createElement(Harness, { credentials: [a] }));
  });
  const replacement = { ...a, sessionId: "replacement-session" };
  await act(async () => renderer.update(createElement(Harness, { credentials: [replacement] })));
  await act(async () => {
    resolveOld({
      ...snapshot("a"),
      threads: [{ id: "stale", projectId: "p", title: "Stale", updatedAt: 1 }],
    });
  });
  const current = published.a!.state;
  expect(current.status === "paired" && current.session.sessionId).toBe("replacement-session");
  expect(current.status === "paired" && current.snapshot?.threads[0]?.id).toBe("same");
  expect(mock.sockets[0]!.disconnect).toHaveBeenCalledOnce();
});

it("ignores an older diff response after a newer read clears the working tree", async () => {
  await act(async () => {
    renderer = create(createElement(Harness, { credentials: [a] }));
  });
  await connect(0);
  let finish!: (value: unknown) => void;
  mock.sockets[0]!.command.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const olderRead = published.a!.loadDiff("same");
  const clean = { id: "same", threadId: "same", title: "Changes", updatedAt: 2, files: [] };
  mock.sockets[0]!.command.mockResolvedValueOnce({ type: "diff.get.result", diff: clean });
  await act(async () => {
    await published.a!.loadDiff("same");
  });
  await act(async () => {
    finish({
      type: "diff.get.result",
      diff: {
        ...clean,
        updatedAt: 1,
        files: [{ path: "old.ts", status: "modified", additions: 10 }],
      },
    });
    await olderRead;
  });
  const current = published.a!.state;
  expect(current.status === "paired" && current.diffs.same).toEqual(clean);
});

it("revokes only the owning session without interrupting another computer", async () => {
  await act(async () => {
    renderer = create(createElement(Harness, { credentials: [a, b] }));
  });
  await connect(0);
  await connect(1);
  await act(async () => {
    mock.sockets[0]!.handlers.onMessage({
      envelope: "error",
      error: { code: "device_revoked", message: "Session revoked", retryable: false },
    });
  });
  expect(mock.clearSession).toHaveBeenCalledWith(a.environmentId, a.sessionId);
  expect(mock.sockets[0]!.disconnect).toHaveBeenCalledOnce();
  expect(published.a!.state.status).toBe("unpaired");
  expect(published.b!.state.status === "paired" && published.b!.state.connectionState).toBe(
    "connected",
  );
  expect(mock.sockets[1]!.disconnect).not.toHaveBeenCalled();
});

it("refreshes each paired machine's label and keeps the last name after an offline restart", async () => {
  const labels: Record<string, string> = { a: "omarchy", b: "MacBook Pro" };
  mock.snapshot.mockImplementation(async (session: GraftSessionCredential) => {
    const next = snapshot(session.environmentId);
    return { ...next, environment: { ...next.environment, label: labels[session.environmentId] } };
  });
  const credentials = [a, b].map((item) => ({ ...item, environmentLabel: "brentwarner" }));
  const names = () =>
    ["a", "b"].map((id) => {
      const state = published[id]!.state;
      return state.status === "paired" ? state.session.environmentLabel : undefined;
    });
  await act(async () => {
    renderer = create(createElement(Harness, { credentials }));
  });
  expect(names()).toEqual(["omarchy", "MacBook Pro"]);
  labels.a = "Office Linux";
  await connect(0);
  expect(names()).toEqual(["Office Linux", "MacBook Pro"]);
  expect(mock.sockets).toHaveLength(2);
  expect(mock.sockets[1]!.disconnect).not.toHaveBeenCalled();
  expect(credentials.map((item) => item.environmentLabel)).toEqual(["brentwarner", "brentwarner"]);

  await act(async () => renderer.unmount());
  mock.snapshot.mockRejectedValue(new GatewayError("Offline", "host_offline"));
  await act(async () => {
    renderer = create(createElement(Harness, { credentials }));
  });
  expect(names()).toEqual(["Office Linux", "MacBook Pro"]);
});
