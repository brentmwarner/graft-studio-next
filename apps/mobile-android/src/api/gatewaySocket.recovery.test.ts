import type { GraftSessionCredential } from "@graft/mobile-contract";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { GatewaySocket } from "./gatewaySocket";

vi.mock("expo-crypto", () => ({ randomUUID: () => "command-id" }));

class FakeWebSocket {
  static OPEN = 1;
  static CLOSING = 2;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  onclose?: () => void;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
  });

  constructor(
    readonly url: string,
    _protocols?: unknown,
    readonly options?: unknown,
  ) {
    FakeWebSocket.instances.push(this);
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  welcome(cursor = 100) {
    this.receive({
      envelope: "welcome",
      protocolVersion: 1,
      capabilities: ["projects"],
      environmentId: "environment-1",
      environmentLabel: "Studio",
      cursor,
    });
  }
  frames() {
    return this.send.mock.calls.map(([text]) => JSON.parse(text));
  }
}

const session: GraftSessionCredential = {
  sessionId: "session-1",
  deviceId: "device-12345678",
  bearerToken: "valid-bearer-token-123",
  environmentId: "environment-1",
  environmentLabel: "Studio",
  httpBaseUrl: "https://relay.test/e/environment-1",
  wsBaseUrl: "wss://relay.test/e/environment-1",
  protocolVersion: 1,
  capabilities: ["projects"],
  expiresAt: null,
};
let socket: GatewaySocket;
const states = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances = [];
  states.mockClear();
  socket = new GatewaySocket({ onMessage: () => {}, onStateChange: states });
  socket.connect(session, 40);
});
afterEach(() => {
  socket.disconnect();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("replaces a silently dead OPEN socket and resumes from received data, not welcome's high-water mark", async () => {
  const old = FakeWebSocket.instances[0]!;
  old.open();
  old.welcome();
  socket.updateCursor(41);
  await vi.advanceTimersByTimeAsync(25_000);
  expect(old.frames().at(-1).envelope).toBe("ping");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(old.close).toHaveBeenCalledOnce();
  expect(states).toHaveBeenLastCalledWith("reconnecting");
  await vi.advanceTimersByTimeAsync(1_000);
  const replacement = FakeWebSocket.instances[1]!;
  replacement.open();
  expect(replacement.frames()[0]).toMatchObject({ envelope: "hello", afterCursor: 41 });
  expect(replacement.options).toEqual({
    headers: { Authorization: `Bearer ${session.bearerToken}` },
  });
});

it.each([false, true])(
  "retries a stalled handshake even without a command waiting (upgraded=%s)",
  async (upgraded) => {
    const old = FakeWebSocket.instances[0]!;
    if (upgraded) old.open();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    old.welcome();
    expect(states).toHaveBeenLastCalledWith("reconnecting");
    const replacement = FakeWebSocket.instances[1]!;
    replacement.open();
    expect(replacement.frames()[0]).toMatchObject({ afterCursor: 40 });
    replacement.welcome();
    expect(states).toHaveBeenLastCalledWith("connected");
  },
);

it("accepts a matching host pong but times out an unrelated pong", async () => {
  const wire = FakeWebSocket.instances[0]!;
  wire.open();
  wire.welcome();
  await vi.advanceTimersByTimeAsync(25_000);
  const firstPing = wire.frames().at(-1);
  wire.receive({ envelope: "pong", at: firstPing.at });
  await vi.advanceTimersByTimeAsync(25_000);
  expect(wire.close).not.toHaveBeenCalled();
  wire.receive({ envelope: "pong", at: firstPing.at });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(wire.close).toHaveBeenCalledOnce();
});

it("immediately rebinds on a cellular handoff, rejects uncertain commands, and ignores late old callbacks", async () => {
  const old = FakeWebSocket.instances[0]!;
  old.open();
  old.welcome();
  const command = socket.command({ type: "turn.start", threadId: "thread-1", text: "Check this" });
  const rejection = expect(command).rejects.toMatchObject({ outcomeUnknown: true });
  await Promise.resolve();
  socket.networkChanged(true);
  await rejection;
  const replacement = FakeWebSocket.instances[1]!;
  replacement.open();
  replacement.welcome();
  old.onerror?.();
  old.onclose?.();
  old.welcome();
  expect(states).toHaveBeenLastCalledWith("connected");
  expect(replacement.frames().map((frame) => frame.envelope)).toEqual(["hello"]);
});

it("pauses attempts offline and bypasses backoff when the network returns", async () => {
  socket.networkChanged(false);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(FakeWebSocket.instances).toHaveLength(1);
  socket.networkChanged(true);
  expect(FakeWebSocket.instances).toHaveLength(2);
});

it("does not reconnect for network changes while backgrounded or unpaired", async () => {
  socket.disconnect();
  socket.networkChanged(false);
  socket.networkChanged(true);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(FakeWebSocket.instances).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
  socket.connect(session, 40);
  expect(FakeWebSocket.instances).toHaveLength(2);
});

it("recovers from native errors that never deliver a close callback", async () => {
  FakeWebSocket.instances[0]!.onerror?.();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(FakeWebSocket.instances).toHaveLength(2);
});

it("rejects a welcome from a different computer before allowing commands", async () => {
  const onMessage = vi.fn();
  socket.disconnect();
  socket = new GatewaySocket({ onMessage, onStateChange: states });
  socket.connect(session);
  const wire = FakeWebSocket.instances.at(-1)!;
  wire.open();
  const pending = socket.command({ type: "turn.start", threadId: "thread-1", text: "Check this" });
  const rejection = expect(pending).rejects.toMatchObject({ code: "socket_closed" });
  wire.receive({
    envelope: "welcome",
    protocolVersion: 1,
    capabilities: ["projects"],
    environmentId: "different-computer",
    environmentLabel: "Other Studio",
    cursor: 1,
  });
  await rejection;
  expect(states).toHaveBeenLastCalledWith("disconnected");
  expect(onMessage).toHaveBeenCalledWith({
    envelope: "error",
    error: {
      code: "authorization_denied",
      message: "Welcome belongs to another computer.",
      retryable: false,
    },
  });
  expect(wire.frames().map((frame) => frame.envelope)).toEqual(["hello"]);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(FakeWebSocket.instances).toHaveLength(2);
});
