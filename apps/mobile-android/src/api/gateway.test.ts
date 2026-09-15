import {
  GRAFT_MOBILE_PROTOCOL_VERSION,
  type GraftPairingPayload,
  type GraftSessionCredential,
} from "@graft/mobile-contract";
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

describe("account usage endpoint", () => {
  const result = {
    threadId: "thread/a b",
    allowance: {
      providerId: "codex",
      status: "ok",
      stale: false,
      limits: [{ label: "Weekly", remainingPercent: 64 }],
    },
  };
  it("authenticates and escapes the selected thread ID", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(result));
    await expect(createGatewayClient(fetcher).usage(session, result.threadId)).resolves.toEqual(
      result,
    );
    const [url, init] = fetcher.mock.calls[0]!;
    expect(new URL(url).pathname).toBe("/v1/usage");
    expect(new URL(url).searchParams.get("threadId")).toBe(result.threadId);
    expect(init?.headers).toEqual({ authorization: `Bearer ${session.bearerToken}` });
  });
  it("rejects responses for another thread and invalid quota values", async () => {
    await expect(
      createGatewayClient(async () => Response.json(result)).usage(session, "different"),
    ).rejects.toMatchObject({ code: "invalid_response" });
    await expect(
      createGatewayClient(async () =>
        Response.json({
          ...result,
          allowance: { ...result.allowance, limits: [{ label: "Weekly", remainingPercent: 150 }] },
        }),
      ).usage(session, result.threadId),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("preserves a legacy host's 404 for the menu's unavailable state", async () => {
    await expect(
      createGatewayClient(async () => new Response("Not Found", { status: 404 })).usage(
        session,
        result.threadId,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

it("uploads binary data using the paired session and preserves attachment metadata", async () => {
  const attachment = {
    id: "host-file",
    type: "file" as const,
    name: "notes & plan.txt",
    mimeType: "text/plain",
    sizeBytes: 5,
  };
  const body = new Blob(["hello"]);
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json(attachment, { status: 201 }),
  );
  expect(
    await createGatewayClient(fetcher).uploadAttachment(session, "thread/a b", attachment, body),
  ).toEqual(attachment);
  const [url, init] = fetcher.mock.calls[0]!;
  expect(new URL(url).pathname).toBe("/api/attachments/upload");
  expect(new URL(url).searchParams.get("threadId")).toBe("thread/a b");
  expect(new URL(url).searchParams.get("name")).toBe(attachment.name);
  expect(init?.body).toEqual(await body.arrayBuffer());
  expect(init?.headers).toMatchObject({ "content-type": "text/plain" });
  expect(init?.headers).toMatchObject({ authorization: `Bearer ${session.bearerToken}` });
});

it("authenticates cancellation and reports host attachment errors", async () => {
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({ cancelled: true }),
  );
  await createGatewayClient(fetcher).cancelAttachment(session, "host-file");
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    method: "POST",
    body: JSON.stringify({ attachmentId: "host-file" }),
    headers: { authorization: `Bearer ${session.bearerToken}` },
  });
  await expect(
    createGatewayClient(async () =>
      Response.json({ error: "Upload quota exceeded." }, { status: 413 }),
    ).cancelAttachment(session, "host-file"),
  ).rejects.toThrow("Upload quota exceeded.");
});

it("uploads extensionless native files without reading their nullable MIME property", async () => {
  const bytes = new TextEncoder().encode("cached document").buffer;
  const file = {
    arrayBuffer: async () => bytes,
    get type(): string {
      throw new Error("Native File MIME must not override metadata");
    },
  } as Blob;
  const attachment = {
    id: "cached-file",
    type: "file" as const,
    name: "document",
    mimeType: "application/octet-stream",
    sizeBytes: bytes.byteLength,
  };
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(attachment));
  await expect(
    createGatewayClient(fetcher).uploadAttachment(session, "thread-1", attachment, file),
  ).resolves.toEqual(attachment);
  expect(fetcher.mock.calls[0]?.[1]?.body).toBe(bytes);
});
