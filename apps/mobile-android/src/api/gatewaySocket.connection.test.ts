import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GatewaySocket, GatewaySocketError, buildWebSocketUrl } from "./gatewaySocket";

vi.mock("expo-crypto", () => ({ randomUUID: () => "command-id" }));

type Handler = ((event?: { data?: string }) => void) | null;

class FakeWebSocket {
  static OPEN = 1;
  static CLOSING = 2;
  static instances: FakeWebSocket[] = [];

  readonly readyState = FakeWebSocket.OPEN;
  onopen: Handler = null;
  onmessage: Handler = null;
  onerror: Handler = null;
  onclose: Handler = null;

  constructor(
    readonly url: string,
    _protocols?: unknown,
    _options?: unknown,
  ) {
    FakeWebSocket.instances.push(this);
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.onclose?.();
  });
}

describe("GatewaySocket connection waiters", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resends the caller's command ID after a lost response and accepts the cached receipt", async () => {
    vi.useFakeTimers();
    const socket = new GatewaySocket({ onMessage: () => {}, onStateChange: () => {} });
    socket.connect({
      sessionId: "session-1",
      deviceId: "device-12345678",
      bearerToken: "valid-bearer-token-123",
      environmentId: "environment-1",
      environmentLabel: "Studio",
      httpBaseUrl: "http://192.168.1.8:4783",
      wsBaseUrl: "ws://192.168.1.8:4783",
      protocolVersion: 1,
      capabilities: ["projects"],
      expiresAt: null,
    });
    const wire = FakeWebSocket.instances[0]!;
    wire.onmessage?.({
      data: JSON.stringify({
        envelope: "welcome",
        protocolVersion: 1,
        capabilities: ["projects"],
        environmentId: "environment-1",
        environmentLabel: "Studio",
        cursor: 0,
      }),
    });
    const command = { type: "turn.start" as const, threadId: "thread-1", text: "Review this" };
    try {
      const first = socket.command(command, "9e4f8b04-214d-4856-9d8e-bb686c89ac33");
      const timedOut = expect(first).rejects.toMatchObject({
        code: "timeout",
        outcomeUnknown: true,
      });
      await vi.advanceTimersByTimeAsync(20_000);
      await timedOut;

      const retry = socket.command(command, "9e4f8b04-214d-4856-9d8e-bb686c89ac33");
      await Promise.resolve();
      const sent = wire.send.mock.calls.map(([frame]) => JSON.parse(frame));
      expect(sent).toEqual([
        { envelope: "command", commandId: "9e4f8b04-214d-4856-9d8e-bb686c89ac33", command },
        { envelope: "command", commandId: "9e4f8b04-214d-4856-9d8e-bb686c89ac33", command },
      ]);
      wire.onmessage?.({
        data: JSON.stringify({
          envelope: "response",
          commandId: "9e4f8b04-214d-4856-9d8e-bb686c89ac33",
          receipt: { commandId: "9e4f8b04-214d-4856-9d8e-bb686c89ac33", status: "completed" },
        }),
      });
      await expect(retry).resolves.toBeUndefined();
    } finally {
      socket.disconnect();
    }
  });

  it("rejects ensureConnected waiters on disconnect instead of hanging", async () => {
    const socket = new GatewaySocket({
      onMessage: () => {},
      onStateChange: () => {},
    });

    socket.connect({
      sessionId: "session-1",
      deviceId: "device-12345678",
      bearerToken: "valid-bearer-token-123",
      environmentId: "environment-1",
      environmentLabel: "Studio",
      httpBaseUrl: "http://192.168.1.8:4783",
      wsBaseUrl: "ws://192.168.1.8:4783",
      protocolVersion: 1,
      capabilities: ["projects"],
      expiresAt: null,
    });

    const pending = socket.command({ type: "models.list" });
    // Disconnect before welcome — the waiter must fail immediately, not sit
    // until the 15s connect timeout.
    socket.disconnect();

    await expect(pending).rejects.toBeInstanceOf(GatewaySocketError);
    await expect(pending).rejects.toMatchObject({
      message: "Disconnected from Graft Studio.",
    });
  });

  it("still builds the websocket URL without the bearer", () => {
    expect(
      buildWebSocketUrl({
        sessionId: "session-1",
        deviceId: "device-12345678",
        bearerToken: "valid-bearer-token-123",
        environmentId: "environment-1",
        environmentLabel: "Studio",
        httpBaseUrl: "http://192.168.1.8:4783",
        wsBaseUrl: "ws://192.168.1.8:4783",
        protocolVersion: 1,
        capabilities: ["projects"],
        expiresAt: null,
      }),
    ).toBe("ws://192.168.1.8:4783/v1/ws?sessionId=session-1");
  });
});
