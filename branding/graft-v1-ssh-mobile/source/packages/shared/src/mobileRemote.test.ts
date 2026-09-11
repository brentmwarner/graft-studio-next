import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GraftCommandReceiptSchema,
  GraftCursorReplaySchema,
  GraftDiffSummarySchema,
  GraftEnvironmentSnapshotSchema,
  GraftMobileClientMessageSchema,
  GraftMobileCommandSchema,
  GraftMobileHostMessageSchema,
  GraftPairExchangeRequestSchema,
  GraftPairExchangeResponseSchema,
  GraftPairingPayloadSchema,
  GraftPushRegistrationRequestSchema,
  GraftPushRegistrationResponseSchema,
  GraftPushUnregistrationRequestSchema,
  GraftRemoteHealthSchema,
  GraftSessionCredentialSchema,
  assertNeverMobile,
  buildGraftPairingUrl,
  describeMobileCommand,
  describeMobileHostMessage,
  parseGraftPairingUrl,
  toWebSocketBaseUrl,
  type GraftMobileCommand,
  type GraftMobileHostMessage,
} from "./mobileRemote.js";

const fixturesRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../protocol-fixtures/mobile-v1",
);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function listFixtures(kind: "valid" | "invalid"): string[] {
  return readdirSync(join(fixturesRoot, kind))
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function schemaForFixture(name: string) {
  if (name.startsWith("health")) return GraftRemoteHealthSchema;
  if (name.startsWith("pair-request")) return GraftPairExchangeRequestSchema;
  if (name.startsWith("pair-response")) return GraftPairExchangeResponseSchema;
  if (name.startsWith("environment-snapshot")) {
    return GraftEnvironmentSnapshotSchema;
  }
  if (name.startsWith("client-")) return GraftMobileClientMessageSchema;
  if (name.startsWith("host-")) return GraftMobileHostMessageSchema;
  if (name.startsWith("command-receipt")) return GraftCommandReceiptSchema;
  if (name.startsWith("cursor-replay")) return GraftCursorReplaySchema;
  if (name.startsWith("diff-summary")) return GraftDiffSummarySchema;
  if (name.startsWith("pairing-payload")) return GraftPairingPayloadSchema;
  if (name.startsWith("protocol-version")) {
    return GraftMobileClientMessageSchema;
  }
  if (name.startsWith("turn-start")) return GraftMobileClientMessageSchema;
  throw new Error(`No schema mapping for fixture ${name}`);
}

describe("mobileRemote pairing helpers", () => {
  it("keeps pairing tokens in the URL fragment", () => {
    const url = buildGraftPairingUrl({
      v: 1,
      host: "http://100.64.0.12:4783",
      token: "abcdefghijklmnopqrstuv",
      label: "Studio",
      endpointKind: "tailnet",
    });
    expect(url.includes("?token=")).toBe(false);
    expect(url).toContain("#token=");
    expect(parseGraftPairingUrl(url)?.endpointKind).toBe("tailnet");
  });

  it("rejects unsupported pairing protocol versions", () => {
    expect(
      parseGraftPairingUrl(
        "graft://pair?v=2&host=http://127.0.0.1:4783#token=abcdefghijklmnopqrstuv",
      ),
    ).toBeNull();
  });

  it("rejects unrelated URLs and query-string credentials", () => {
    const query = "v=1&host=http://127.0.0.1:4783&token=abcdefghijklmnopqrstuv";
    expect(parseGraftPairingUrl(`graft://connect?${query}`)).toBeNull();
    expect(
      parseGraftPairingUrl(`https://example.test/not-pair?${query}`),
    ).toBeNull();
    expect(parseGraftPairingUrl(`graft://pair?${query}`)).toBeNull();
    expect(
      parseGraftPairingUrl(
        "graft://pair?v=1garbage&host=http://127.0.0.1:4783#token=abcdefghijklmnopqrstuv",
      ),
    ).toBeNull();
  });

  it("accepts the documented HTTPS pairing route", () => {
    expect(
      parseGraftPairingUrl(
        "https://studio.example.test/pair?v=1&host=https://studio.example.test:4783#token=abcdefghijklmnopqrstuv",
      ),
    ).toMatchObject({
      v: 1,
      host: "https://studio.example.test:4783",
      token: "abcdefghijklmnopqrstuv",
    });
  });

  it("rejects pairing payloads outside the mobile transport contract", () => {
    const valid = {
      v: 1 as const,
      host: "https://studio.example.test:4783",
      token: "abcdefghijklmnopqrstuv",
      label: "Studio",
      endpointKind: "https" as const,
    };

    expect(GraftPairingPayloadSchema.safeParse(valid).success).toBe(true);
    expect(
      GraftPairingPayloadSchema.safeParse({ ...valid, host: "ftp://host/path" })
        .success,
    ).toBe(false);
    expect(
      GraftPairingPayloadSchema.safeParse({ ...valid, token: "too-short" })
        .success,
    ).toBe(false);
    expect(
      GraftPairingPayloadSchema.safeParse({
        ...valid,
        token: "invalid token characters",
      }).success,
    ).toBe(false);
    expect(
      GraftPairingPayloadSchema.safeParse({
        ...valid,
        endpointKind: "internet",
      }).success,
    ).toBe(false);
  });

  it("refuses to build invalid pairing URLs", () => {
    expect(() =>
      buildGraftPairingUrl({
        v: 1,
        host: "ftp://studio.example.test",
        token: "abcdefghijklmnopqrstuv",
      }),
    ).toThrow();
  });

  it("maps http hosts to ws bases", () => {
    expect(toWebSocketBaseUrl("http://192.168.1.8:4783/")).toBe(
      "ws://192.168.1.8:4783",
    );
    expect(toWebSocketBaseUrl("https://mac.tailnet.ts.net")).toBe(
      "wss://mac.tailnet.ts.net",
    );
  });
});

describe("mobileRemote managed relay endpoints", () => {
  const relaySession = {
    sessionId: "sess-relay-1",
    deviceId: "dev-relay-1",
    bearerToken: "0123456789abcdef0123456789abcdef",
    environmentId: "env-relay-1",
    environmentLabel: "Studio Mac",
    httpBaseUrl: "https://relay.graftapp.io/e/env-relay-1",
    wsBaseUrl: "wss://relay.graftapp.io/e/env-relay-1",
    protocolVersion: 1 as const,
    capabilities: ["projects" as const],
    expiresAt: null,
  };

  it("round-trips a relay pairing URL without a LAN address", () => {
    const url = buildGraftPairingUrl({
      v: 1,
      host: "https://relay.graftapp.io/e/env-relay-1",
      token: "abcdefghijklmnopqrstuv",
      label: "Studio Mac",
      endpointKind: "relay",
    });
    const parsed = parseGraftPairingUrl(url);

    expect(parsed?.endpointKind).toBe("relay");
    expect(parsed?.host).toBe("https://relay.graftapp.io/e/env-relay-1");
    expect(url).not.toMatch(/192\.168\.|100\.6[4-9]\./);
  });

  it("records the transport a session was issued over", () => {
    const parsed = GraftSessionCredentialSchema.parse({
      ...relaySession,
      endpointKind: "relay",
    });
    expect(parsed.endpointKind).toBe("relay");
  });

  it("keeps endpointKind optional so pre-relay sessions still parse", () => {
    const parsed = GraftSessionCredentialSchema.parse(relaySession);
    expect(parsed.endpointKind).toBeUndefined();
  });

  it("rejects a transport outside the endpoint contract", () => {
    expect(
      GraftSessionCredentialSchema.safeParse({
        ...relaySession,
        endpointKind: "carrier-pigeon",
      }).success,
    ).toBe(false);
  });

  it("maps a relay https base to a wss base", () => {
    expect(toWebSocketBaseUrl("https://relay.graftapp.io/e/env-relay-1")).toBe(
      "wss://relay.graftapp.io/e/env-relay-1",
    );
  });
});

describe("mobileRemote push registration schemas", () => {
  it("accepts variable-length lowercase APNs tokens", () => {
    for (const apnsToken of ["ab", "0123456789abcdef".repeat(16)]) {
      expect(
        GraftPushRegistrationRequestSchema.safeParse({
          apnsToken,
          apnsEnvironment: "sandbox",
          bundleId: "studio.graft.mobile",
        }).success,
      ).toBe(true);
    }
  });

  it("rejects malformed tokens and client-supplied device authorization", () => {
    for (const apnsToken of ["a", "ABCDEF", "not-hex", "ab".repeat(257)]) {
      expect(
        GraftPushRegistrationRequestSchema.safeParse({
          apnsToken,
          apnsEnvironment: "production",
          bundleId: "studio.graft.mobile",
        }).success,
      ).toBe(false);
    }
    expect(
      GraftPushRegistrationRequestSchema.safeParse({
        apnsToken: "aabbccdd",
        apnsEnvironment: "sandbox",
        bundleId: "studio.graft.mobile",
        deviceId: "attacker-selected-device",
      }).success,
    ).toBe(false);
    expect(
      GraftPushUnregistrationRequestSchema.safeParse({ deviceId: "device-1" })
        .success,
    ).toBe(false);
  });

  it("keeps raw APNs token material out of registration metadata", () => {
    const parsed = GraftPushRegistrationResponseSchema.parse({
      ok: true,
      registration: {
        deviceId: "device-1",
        apnsEnvironment: "sandbox",
        bundleId: "studio.graft.mobile",
        createdAt: 1,
        updatedAt: 2,
      },
    });
    expect(JSON.stringify(parsed)).not.toContain("apnsToken");
  });
});

describe("mobileRemote fixtures", () => {
  it("parses every valid fixture", () => {
    const names = listFixtures("valid");
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      const schema = schemaForFixture(name);
      const parsed = schema.safeParse(
        readJson(join(fixturesRoot, "valid", name)),
      );
      expect(parsed.success, `${name} should parse`).toBe(true);
    }
  });

  it("rejects every invalid fixture", () => {
    const names = listFixtures("invalid");
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) {
      const schema = schemaForFixture(name);
      const parsed = schema.safeParse(
        readJson(join(fixturesRoot, "invalid", name)),
      );
      expect(parsed.success, `${name} should fail`).toBe(false);
    }
  });
});

describe("mobileRemote exhaustive helpers", () => {
  it("describes every command variant", () => {
    const commands: GraftMobileCommand[] = [
      { type: "project.list" },
      { type: "thread.list" },
      { type: "thread.open", threadId: "t1" },
      {
        type: "thread.create",
        projectId: "p1",
        mode: "worktree",
        modelId: "gpt-5.6-sol",
        providerId: "openai",
        approvalPolicy: "full-access",
      },
      { type: "turn.start", threadId: "t1", text: "hi" },
      { type: "turn.cancel", runId: "r1" },
      { type: "turn.steer", runId: "r1", text: "nudge" },
      { type: "approval.resolve", approvalId: "a1", decision: "deny" },
      { type: "question.resolve", questionId: "q1", text: "yes" },
      { type: "diff.get", diffId: "d1" },
      { type: "cursor.replay", afterCursor: 0 },
      { type: "snapshot.get" },
    ];
    for (const command of commands) {
      expect(GraftMobileCommandSchema.parse(command).type).toBe(command.type);
      expect(describeMobileCommand(command)).toBe(command.type);
    }
  });

  it("describes every host envelope", () => {
    const messages: GraftMobileHostMessage[] = [
      {
        envelope: "welcome",
        protocolVersion: 1,
        capabilities: ["projects"],
        environmentId: "env-1",
        environmentLabel: "Mac",
        cursor: 0,
      },
      { envelope: "pong", at: 1 },
      {
        envelope: "response",
        commandId: "11111111-1111-4111-8111-111111111111",
        receipt: {
          commandId: "11111111-1111-4111-8111-111111111111",
          status: "accepted",
        },
      },
      {
        envelope: "event",
        event: {
          id: "e1",
          cursor: 1,
          kind: "user.message",
          threadId: "t1",
          createdAt: 1,
          text: "hi",
        },
      },
      {
        envelope: "error",
        error: { code: "validation_failed", message: "bad" },
      },
      { envelope: "snapshot_required", reason: "resync" },
    ];
    for (const message of messages) {
      expect(GraftMobileHostMessageSchema.parse(message).envelope).toBe(
        message.envelope,
      );
      expect(describeMobileHostMessage(message)).toBe(message.envelope);
    }
  });

  it("assertNeverMobile throws", () => {
    expect(() => assertNeverMobile("nope" as never)).toThrow(/Unhandled/);
  });
});
