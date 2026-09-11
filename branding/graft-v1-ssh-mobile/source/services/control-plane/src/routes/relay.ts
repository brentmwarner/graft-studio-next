import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import {
  GRAFT_RELAY_ENVIRONMENTS_PATH,
  GRAFT_RELAY_UPLINK_PATH,
  buildRelayEnvironmentHttpBaseUrl,
  parseRelayUplinkFrame,
  toWebSocketBaseUrl,
} from "@graft/shared";
import type { TursoStore } from "../infra/tursoStore";
import {
  RELAY_MAX_BODY_BYTES,
  RelayHostOfflineError,
  createRelayMux,
  type RelayMux,
  type RelayStream,
} from "../lib/relayMux";
import { getAuthUser, workosAuth } from "../middleware/auth";

/**
 * Managed mobile relay.
 *
 * The phone speaks the unmodified mobile remote protocol against
 * `/e/{environmentId}/v1/...`; the desktop dials out to `/relay/v1/uplink` and
 * answers those requests over one multiplexed socket. Pairing tokens and
 * session bearers pass through untouched — the relay authenticates only the
 * uplink, and never inspects, logs, or stores a forwarded body.
 */

const MAX_REQUEST_BODY_BYTES = RELAY_MAX_BODY_BYTES;
const MAX_PHONE_BACKLOG_BYTES = RELAY_MAX_BODY_BYTES;
const UPLINK_REGISTER_TIMEOUT_MS = 10_000;

/** Headers that describe one hop and must not be forwarded to the next. */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

const CreateEnvironmentBodySchema = z
  .object({
    label: z.string().min(1).max(120).optional(),
    environmentId: z.string().min(1).max(128).optional(),
  })
  .strict();

export interface RelayRoutesOptions {
  mux?: RelayMux;
  /** Absolute public origin of the relay, e.g. `https://relay.graftapp.io`. */
  publicUrl?: string;
}

export async function registerRelayRoutes(
  server: FastifyInstance,
  store: TursoStore,
  options: RelayRoutesOptions = {},
): Promise<void> {
  const mux = options.mux ?? createRelayMux();
  const configuredPublicUrl = options.publicUrl ?? process.env.RELAY_PUBLIC_URL;

  function publicOriginFor(request: {
    headers: Record<string, string | string[] | undefined>;
  }): string {
    if (configuredPublicUrl) {
      return configuredPublicUrl.replace(/\/+$/, "");
    }
    const forwardedProto = firstHeaderValue(request.headers["x-forwarded-proto"]);
    const forwardedHost = firstHeaderValue(request.headers["x-forwarded-host"]);
    const host = forwardedHost ?? firstHeaderValue(request.headers.host);
    const proto = forwardedProto ?? "https";
    return `${proto}://${host ?? "localhost"}`;
  }

  function environmentUrls(origin: string, environmentId: string) {
    const httpBaseUrl = buildRelayEnvironmentHttpBaseUrl(origin, environmentId);
    return { httpBaseUrl, wsBaseUrl: toWebSocketBaseUrl(httpBaseUrl) };
  }

  server.post(
    GRAFT_RELAY_ENVIRONMENTS_PATH,
    { preHandler: workosAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = CreateEnvironmentBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid relay environment request" });
      }

      const account = getAuthUser(request);
      const uplinkSecret = randomBytes(32).toString("base64url");
      const uplinkSecretDigest = hashSecret(uplinkSecret);
      const now = new Date().toISOString();

      let environmentId = parsed.data.environmentId;
      if (environmentId) {
        const rotated = await store.rotateRelayEnvironmentSecret({
          environmentId,
          accountId: account.accountId,
          uplinkSecretDigest,
          ...(parsed.data.label ? { label: parsed.data.label } : {}),
        });
        if (!rotated) {
          // Either unknown or owned by a different account. Both answer the
          // same so environment IDs cannot be probed for existence.
          return reply.status(404).send({ error: "Relay environment not found" });
        }
      } else {
        environmentId = `env_${randomBytes(12).toString("hex")}`;
        await store.createRelayEnvironment({
          environmentId,
          accountId: account.accountId,
          uplinkSecretDigest,
          ...(parsed.data.label ? { label: parsed.data.label } : {}),
          createdAt: now,
        });
      }

      const origin = publicOriginFor(request);
      const { httpBaseUrl, wsBaseUrl } = environmentUrls(origin, environmentId);
      return reply.status(201).send({
        environmentId,
        uplinkSecret,
        httpBaseUrl,
        wsBaseUrl,
        uplinkUrl: `${toWebSocketBaseUrl(origin)}${GRAFT_RELAY_UPLINK_PATH}`,
      });
    },
  );

  // The phone plane is a byte pipe, so it bypasses Fastify body parsing and
  // routing entirely: hijack the reply and stream the raw request through.
  server.addHook("onRequest", async (request, reply) => {
    const target = parseEnvironmentPath(request.url);
    if (!target) return;
    reply.hijack();
    await forwardPhoneRequest(request.raw, reply.raw, target);
  });

  async function forwardPhoneRequest(
    raw: IncomingMessage,
    response: ServerResponse,
    target: { environmentId: string; forwardPath: string },
  ): Promise<void> {
    if (!mux.hasUplink(target.environmentId)) {
      writeRelayError(response, 503, "host_offline");
      return;
    }

    let body: Buffer;
    try {
      body = await readBody(raw);
    } catch {
      writeRelayError(response, 413, "validation_failed");
      return;
    }

    try {
      const result = await mux.request(target.environmentId, {
        method: raw.method ?? "GET",
        path: target.forwardPath,
        headers: forwardableHeaders(raw.headers),
        body,
      });
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(result.headers)) {
        if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
        headers[name] = value;
      }
      headers["content-length"] = String(result.body.byteLength);
      response.writeHead(result.status, headers);
      response.end(result.body);
    } catch (error) {
      if (error instanceof RelayHostOfflineError) {
        writeRelayError(response, 503, "host_offline");
        return;
      }
      writeRelayError(response, 504, "internal");
    }
  }

  // --- WebSocket planes -----------------------------------------------------

  const uplinkServer = new WebSocketServer({ noServer: true });
  const phoneServer = new WebSocketServer({ noServer: true });

  server.server.on("upgrade", (raw: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = pathnameOf(raw.url);

    if (pathname === GRAFT_RELAY_UPLINK_PATH) {
      uplinkServer.handleUpgrade(raw, socket, head, (ws) => {
        handleUplinkSocket(ws, raw);
      });
      return;
    }

    const target = parseEnvironmentPath(raw.url);
    if (target && target.forwardPath.split("?")[0] === "/v1/ws") {
      if (!mux.hasUplink(target.environmentId)) {
        destroyWithStatus(socket, 503, "host_offline");
        return;
      }
      phoneServer.handleUpgrade(raw, socket, head, (ws) => {
        void handlePhoneSocket(ws, raw, target);
      });
      return;
    }

    // Not ours: leave other upgrade listeners a chance, then reject.
    if (server.server.listenerCount("upgrade") <= 1) {
      socket.destroy();
    }
  });

  function handleUplinkSocket(ws: WebSocket, raw: IncomingMessage): void {
    let handle: ReturnType<RelayMux["attachUplink"]> | null = null;

    const registerTimer = setTimeout(() => {
      if (!handle) {
        ws.close(4401, "register_timeout");
      }
    }, UPLINK_REGISTER_TIMEOUT_MS);
    registerTimer.unref?.();

    ws.on("message", (data) => {
      const text = toText(data);
      if (handle) {
        handle.handleMessage(text);
        return;
      }

      void (async () => {
        const frame = parseFirstFrame(text);
        if (!frame) {
          ws.close(4400, "malformed");
          return;
        }

        const environment = await store.findRelayEnvironment(
          frame.environmentId,
        );
        if (
          !environment ||
          !secretMatches(frame.uplinkSecret, environment.uplinkSecretDigest)
        ) {
          send(ws, { type: "register-failed", reason: "unauthorized" });
          ws.close(4401, "unauthorized");
          return;
        }

        clearTimeout(registerTimer);
        const origin = publicOriginFor(raw as unknown as {
          headers: Record<string, string | string[] | undefined>;
        });
        const { httpBaseUrl, wsBaseUrl } = environmentUrls(
          origin,
          frame.environmentId,
        );
        handle = mux.attachUplink({
          environmentId: frame.environmentId,
          socket: {
            send: (payload) => ws.send(payload),
            close: (code, reason) => ws.close(code, reason),
          },
          httpBaseUrl,
          wsBaseUrl,
        });
        await store
          .touchRelayEnvironment(frame.environmentId, new Date().toISOString())
          .catch(() => undefined);
      })().catch(() => {
        if (!handle && ws.readyState === ws.OPEN) {
          ws.close(1011, "register_failed");
        }
      });
    });

    const teardown = () => {
      clearTimeout(registerTimer);
      handle?.detach();
      handle = null;
    };
    ws.on("close", teardown);
    ws.on("error", teardown);
  }

  async function handlePhoneSocket(
    ws: WebSocket,
    raw: IncomingMessage,
    target: { environmentId: string; forwardPath: string },
  ): Promise<void> {
    let stream: RelayStream | null = null;
    const backlog: Array<{ data: Buffer; binary: boolean }> = [];
    let backlogBytes = 0;
    let closed = false;

    ws.on("message", (data, isBinary) => {
      const buffer = toBuffer(data);
      if (stream) {
        stream.send(buffer, isBinary);
        return;
      }
      backlogBytes += buffer.byteLength;
      if (backlogBytes > MAX_PHONE_BACKLOG_BYTES) {
        closed = true;
        ws.close(1009, "backlog_too_large");
        return;
      }
      backlog.push({ data: buffer, binary: isBinary });
    });
    ws.on("close", (code, reason) => {
      closed = true;
      stream?.close(normalizeCloseCode(code), reason.toString("utf8"));
    });
    ws.on("error", () => {
      closed = true;
      stream?.close(1011, "phone_socket_error");
    });

    try {
      stream = await mux.openStream(
        target.environmentId,
        {
          path: target.forwardPath,
          headers: forwardableHeaders(raw.headers),
        },
        {
          onFrame: (data, binary) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(data, { binary });
            }
          },
          onClose: (code, reason) => {
            if (ws.readyState === ws.OPEN) {
              ws.close(normalizeCloseCode(code), reason?.slice(0, 123));
            }
          },
        },
      );
    } catch {
      ws.close(1013, "host_offline");
      return;
    }

    if (closed) {
      stream.close(1000, "phone_gone");
      return;
    }
    for (const pending of backlog) {
      stream.send(pending.data, pending.binary);
    }
    backlog.length = 0;
  }

  server.addHook("onClose", async () => {
    mux.closeAll();
    uplinkServer.close();
    phoneServer.close();
  });
}

// --- helpers ----------------------------------------------------------------

function parseFirstFrame(
  text: string,
): { environmentId: string; uplinkSecret: string } | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  const frame = parseRelayUplinkFrame(decoded);
  if (!frame || frame.type !== "register") return null;
  return {
    environmentId: frame.environmentId,
    uplinkSecret: frame.uplinkSecret,
  };
}

export function parseEnvironmentPath(
  rawUrl: string | undefined,
): { environmentId: string; forwardPath: string } | null {
  if (!rawUrl) return null;
  const [pathname = "", query = ""] = rawUrl.split("?", 2);
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 3 || segments[0] !== "e") return null;

  let environmentId: string;
  try {
    environmentId = decodeURIComponent(segments[1] ?? "");
  } catch {
    return null;
  }
  if (!environmentId) return null;

  const rest = segments.slice(2);
  if (rest[0] !== "v1") return null;
  const forwardPath = `/${rest.join("/")}${query ? `?${query}` : ""}`;
  return { environmentId, forwardPath };
}

function pathnameOf(rawUrl: string | undefined): string {
  return (rawUrl ?? "/").split("?", 1)[0] ?? "/";
}

function forwardableHeaders(
  headers: IncomingMessage["headers"],
): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower.startsWith("sec-websocket-")) continue;
    if (value === undefined) continue;
    forwarded[lower] = Array.isArray(value) ? value.join(", ") : value;
  }
  return forwarded;
}

async function readBody(raw: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of raw) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_REQUEST_BODY_BYTES) {
      throw new Error("relay_request_too_large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function writeRelayError(
  response: ServerResponse,
  status: number,
  code: "host_offline" | "validation_failed" | "internal",
): void {
  const body = JSON.stringify({
    ok: false,
    error: { code, message: relayErrorMessage(code), retryable: status >= 500 },
  });
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(body)),
  });
  response.end(body);
}

function relayErrorMessage(
  code: "host_offline" | "validation_failed" | "internal",
): string {
  switch (code) {
    case "host_offline":
      return "The Graft desktop for this environment is not connected.";
    case "validation_failed":
      return "The relayed request was rejected before forwarding.";
    case "internal":
      return "The Graft desktop did not answer in time.";
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}

function destroyWithStatus(
  socket: Duplex,
  status: number,
  reason: string,
): void {
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

function send(ws: WebSocket, frame: unknown): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch {
    // The socket is already gone.
  }
}

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(String(data));
}

function toText(data: unknown): string {
  return toBuffer(data).toString("utf8");
}

/**
 * `ws` reports 1005/1006 for "no status" and abnormal closes, both of which
 * are illegal to send back out on another socket.
 */
function normalizeCloseCode(code: number | undefined): number {
  if (code === undefined) return 1000;
  if (code < 1000 || code > 4999 || code === 1005 || code === 1006) return 1000;
  return code;
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function secretMatches(presented: string, expectedDigest: string): boolean {
  const presentedDigest = Buffer.from(hashSecret(presented), "utf8");
  const expected = Buffer.from(expectedDigest, "utf8");
  if (presentedDigest.length !== expected.length) return false;
  return timingSafeEqual(presentedDigest, expected);
}

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
