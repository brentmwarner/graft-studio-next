import type { GraftSessionCredential } from "@graft/mobile-contract";
import { describe, expect, it } from "vitest";

import { developmentSessionEndpoint } from "./developmentSessionEndpoint";

const session = {
  httpBaseUrl: "http://100.70.80.90:47831",
  wsBaseUrl: "ws://100.70.80.90:47831",
} as GraftSessionCredential;

describe("developmentSessionEndpoint", () => {
  it("uses an explicit simulator endpoint during local development", () => {
    expect(
      developmentSessionEndpoint({
        host: "http://127.0.0.1:49784/path?ignored=true",
        isDevelopment: true,
        isDevice: false,
        session,
      }),
    ).toMatchObject({
      httpBaseUrl: "http://127.0.0.1:49784",
      wsBaseUrl: "ws://127.0.0.1:49784",
    });
  });

  it("never overrides production or physical-device credentials", () => {
    expect(
      developmentSessionEndpoint({
        host: "http://127.0.0.1:49784",
        isDevelopment: false,
        isDevice: false,
        session,
      }),
    ).toBe(session);
    expect(
      developmentSessionEndpoint({
        host: "http://127.0.0.1:49784",
        isDevelopment: true,
        isDevice: true,
        session,
      }),
    ).toBe(session);
  });
});
