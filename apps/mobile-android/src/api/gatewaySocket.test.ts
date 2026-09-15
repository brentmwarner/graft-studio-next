import { GRAFT_MOBILE_PROTOCOL_VERSION, type GraftSessionCredential } from "@graft/mobile-contract";
import { describe, expect, it, vi } from "vitest";

import { buildWebSocketUrl } from "./gatewaySocket";

vi.mock("expo-crypto", () => ({ randomUUID: () => "command-id" }));

const session: GraftSessionCredential = {
  sessionId: "session-1",
  deviceId: "device-12345678",
  bearerToken: "valid-bearer-token-123",
  environmentId: "environment-1",
  environmentLabel: "Studio",
  httpBaseUrl: "http://192.168.1.8:4783",
  wsBaseUrl: "ws://192.168.1.8:4783",
  protocolVersion: GRAFT_MOBILE_PROTOCOL_VERSION,
  capabilities: ["projects"],
  expiresAt: null,
};

describe("buildWebSocketUrl", () => {
  it("resolves the gateway route without putting the bearer in the URL", () => {
    const url = buildWebSocketUrl(session);

    expect(url).toBe("ws://192.168.1.8:4783/v1/ws?sessionId=session-1");
    expect(url).not.toContain(session.bearerToken);
  });

  it("does not duplicate an already resolved gateway route", () => {
    expect(buildWebSocketUrl({ ...session, wsBaseUrl: "wss://studio.test/v1/ws" })).toBe(
      "wss://studio.test/v1/ws?sessionId=session-1",
    );
  });
});
