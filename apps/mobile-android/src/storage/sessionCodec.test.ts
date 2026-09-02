import {
  GRAFT_MOBILE_PROTOCOL_VERSION,
  type GraftSessionCredential,
} from "@graft/mobile-contract";
import { describe, expect, it } from "vitest";

import {
  decodeSessionMetadata,
  encodeSessionMetadata,
  SessionStorageError,
} from "./sessionCodec";

const session: GraftSessionCredential = {
  sessionId: "session-1",
  deviceId: "device-12345678",
  bearerToken: "super-secret-bearer-token",
  environmentId: "environment-1",
  environmentLabel: "Studio",
  httpBaseUrl: "http://192.168.1.42:47321",
  wsBaseUrl: "ws://192.168.1.42:47321",
  protocolVersion: GRAFT_MOBILE_PROTOCOL_VERSION,
  capabilities: ["projects", "threads"],
  expiresAt: null,
};

describe("session metadata codec", () => {
  it("keeps the bearer credential out of SQLite metadata", () => {
    const encoded = encodeSessionMetadata(session);

    expect(encoded).not.toContain(session.bearerToken);
    expect(decodeSessionMetadata(encoded, session.bearerToken)).toEqual(
      session,
    );
  });

  it("remembers that a session was issued over the managed relay", () => {
    const relaySession: GraftSessionCredential = {
      ...session,
      httpBaseUrl: "https://relay.graftapp.io/e/env-1",
      wsBaseUrl: "wss://relay.graftapp.io/e/env-1",
      endpointKind: "relay",
    };

    const decoded = decodeSessionMetadata(
      encodeSessionMetadata(relaySession),
      relaySession.bearerToken,
    );
    expect(decoded).toEqual(relaySession);
    expect(decoded.endpointKind).toBe("relay");
  });

  it("still reads sessions stored before the relay existed", () => {
    const decoded = decodeSessionMetadata(
      encodeSessionMetadata(session),
      session.bearerToken,
    );
    expect(decoded.endpointKind).toBeUndefined();
  });

  it("rejects corrupted metadata", () => {
    expect(() => decodeSessionMetadata("{}", session.bearerToken)).toThrow(
      SessionStorageError,
    );
  });
});
