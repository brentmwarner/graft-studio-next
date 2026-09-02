import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GatewaySocket,
  GatewaySocketError,
  buildWebSocketUrl,
} from "./gatewaySocket";

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
