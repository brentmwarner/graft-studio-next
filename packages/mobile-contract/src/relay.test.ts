import { describe, expect, it } from "vitest";
import {
  GRAFT_RELAY_PROTOCOL_VERSION,
  buildRelayEnvironmentHttpBaseUrl,
  parseRelayDownlinkFrame,
  parseRelayUplinkFrame,
} from "./relay";

describe("mobileRelay uplink frames", () => {
  it("accepts a register frame carrying the uplink secret", () => {
    const frame = parseRelayUplinkFrame({
      type: "register",
      protocolVersion: GRAFT_RELAY_PROTOCOL_VERSION,
      environmentId: "env-1",
      uplinkSecret: "0123456789abcdef0123",
    });
    expect(frame?.type).toBe("register");
  });

  it("rejects a register frame with a trivially short secret", () => {
    expect(
      parseRelayUplinkFrame({
        type: "register",
        protocolVersion: GRAFT_RELAY_PROTOCOL_VERSION,
        environmentId: "env-1",
        uplinkSecret: "short",
      }),
    ).toBeNull();
  });

  it("rejects a register frame from an unsupported relay version", () => {
    expect(
      parseRelayUplinkFrame({
        type: "register",
        protocolVersion: 2,
        environmentId: "env-1",
        uplinkSecret: "0123456789abcdef0123",
      }),
    ).toBeNull();
  });

  it("carries HTTP responses as opaque base64 bodies", () => {
    const frame = parseRelayUplinkFrame({
      type: "http-response",
      requestId: "req-1",
      status: 200,
      headers: { "content-type": "application/json" },
      bodyBase64: Buffer.from('{"ok":true}').toString("base64"),
    });
    expect(frame).toMatchObject({ type: "http-response", status: 200 });
  });

  it("rejects an out-of-range HTTP status", () => {
    expect(
      parseRelayUplinkFrame({
        type: "http-response",
        requestId: "req-1",
        status: 42,
        headers: {},
      }),
    ).toBeNull();
  });

  it("rejects a downlink-only frame arriving on the uplink", () => {
    expect(
      parseRelayUplinkFrame({
        type: "http",
        requestId: "req-1",
        method: "GET",
        path: "/v1/health",
        headers: {},
      }),
    ).toBeNull();
  });
});

describe("mobileRelay downlink frames", () => {
  it("accepts a forwarded phone request", () => {
    const frame = parseRelayDownlinkFrame({
      type: "http",
      requestId: "req-1",
      method: "POST",
      path: "/v1/pair",
      headers: { "content-type": "application/json" },
      bodyBase64: Buffer.from("{}").toString("base64"),
    });
    expect(frame).toMatchObject({ type: "http", path: "/v1/pair" });
  });

  it("accepts registration acknowledgement with phone-facing base URLs", () => {
    const frame = parseRelayDownlinkFrame({
      type: "registered",
      environmentId: "env-1",
      httpBaseUrl: "https://relay.example/e/env-1",
      wsBaseUrl: "wss://relay.example/e/env-1",
    });
    expect(frame).toMatchObject({ type: "registered" });
  });

  it("rejects registration acknowledgement without absolute URLs", () => {
    expect(
      parseRelayDownlinkFrame({
        type: "registered",
        environmentId: "env-1",
        httpBaseUrl: "/e/env-1",
        wsBaseUrl: "/e/env-1",
      }),
    ).toBeNull();
  });

  it("shares ws-frame and ws-close in both directions", () => {
    const wsFrame = {
      type: "ws-frame" as const,
      streamId: "stream-1",
      dataBase64: Buffer.from("hello").toString("base64"),
    };
    expect(parseRelayUplinkFrame(wsFrame)).not.toBeNull();
    expect(parseRelayDownlinkFrame(wsFrame)).not.toBeNull();
  });

  it("rejects a non-base64 websocket payload", () => {
    expect(
      parseRelayDownlinkFrame({
        type: "ws-frame",
        streamId: "stream-1",
        dataBase64: "not base64!",
      }),
    ).toBeNull();
  });
});

describe("buildRelayEnvironmentHttpBaseUrl", () => {
  it("builds the phone-facing environment base", () => {
    expect(buildRelayEnvironmentHttpBaseUrl("https://relay.example", "env-1")).toBe(
      "https://relay.example/e/env-1",
    );
  });

  it("drops any path, query, or fragment on the relay base", () => {
    expect(buildRelayEnvironmentHttpBaseUrl("https://relay.example/ignored?a=1#b", "env-1")).toBe(
      "https://relay.example/e/env-1",
    );
  });

  it("escapes environment identifiers into a single path segment", () => {
    expect(buildRelayEnvironmentHttpBaseUrl("https://relay.example", "env/../admin")).toBe(
      "https://relay.example/e/env%2F..%2Fadmin",
    );
  });
});
