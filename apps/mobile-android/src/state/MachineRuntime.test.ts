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
