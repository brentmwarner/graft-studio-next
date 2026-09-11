import {
  GRAFT_MOBILE_PROTOCOL_VERSION,
  buildGraftPairingUrl,
  type GraftPairingPayload,
} from "@graft/shared/mobile";
import { describe, expect, it } from "vitest";

import { PairingInputError, parsePairingInput } from "./pairing";

const payload: GraftPairingPayload = {
  v: GRAFT_MOBILE_PROTOCOL_VERSION,
  host: "http://192.168.1.42:47321",
  token: "valid-pairing-token-123",
  label: "Studio Mac",
  endpointKind: "lan",
};

describe("parsePairingInput", () => {
  it("parses Graft pairing links", () => {
    expect(parsePairingInput(buildGraftPairingUrl(payload))).toEqual(payload);
  });

  it("parses raw pairing JSON emitted by compatible hosts", () => {
    expect(parsePairingInput(JSON.stringify(payload))).toEqual(payload);
  });

  it("parses a relay pairing link that carries no LAN address", () => {
    const relayPayload: GraftPairingPayload = {
      ...payload,
      host: "https://relay.graftapp.io/e/env-9f2c",
      endpointKind: "relay",
    };

    const parsed = parsePairingInput(buildGraftPairingUrl(relayPayload));
    expect(parsed).toEqual(relayPayload);
    expect(parsed.host).not.toMatch(/^http:\/\/(192\.168|100)\./);
  });

  it("rejects arbitrary input", () => {
    expect(() => parsePairingInput("hello")).toThrow(PairingInputError);
  });
});
