import {
  GRAFT_MOBILE_PROTOCOL_VERSION,
  type GraftPairingPayload,
  type GraftSessionCredential,
} from "@graft/shared/mobile";
import { describe, expect, it, vi } from "vitest";

import { createGatewayClient, GatewayError } from "./gateway";

vi.mock("expo/fetch", () => ({ fetch: globalThis.fetch }));

const pairing: GraftPairingPayload = {
  v: GRAFT_MOBILE_PROTOCOL_VERSION,
  host: "https://studio.example.test",
  token: "valid-pairing-token-123",
};

const session: GraftSessionCredential = {
  sessionId: "session-1",
  deviceId: "device-12345678",
  bearerToken: "valid-bearer-token-123",
  environmentId: "environment-1",
  environmentLabel: "Studio",
  httpBaseUrl: pairing.host,
  wsBaseUrl: "wss://studio.example.test",
  protocolVersion: GRAFT_MOBILE_PROTOCOL_VERSION,
  capabilities: ["projects"],
  expiresAt: null,
};

describe("createGatewayClient", () => {
  it("sends Android identity when exchanging a pairing token", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      Response.json({ ok: true, session }, { status: 200 }),
    );
    const gateway = createGatewayClient(fetcher);

    await expect(
      gateway.pair(pairing, {
        appVersion: "0.1.0",
        deviceId: "device-12345678",
        deviceLabel: "Pixel",
      }),
    ).resolves.toEqual(session);

    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      client: { platform: "android", deviceId: "device-12345678" },
    });
  });

  it("maps typed gateway errors", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: "pairing_token_invalid",
            message: "Pairing code expired",
          },
        },
        { status: 401 },
      ),
    );
    const gateway = createGatewayClient(fetcher);

    await expect(
      gateway.pair(pairing, {
        appVersion: "0.1.0",
        deviceId: "device-12345678",
      }),
    ).rejects.toMatchObject({
      code: "pairing_token_invalid",
      message: "Pairing code expired",
      status: 401,
    } satisfies Partial<GatewayError>);
  });
});
