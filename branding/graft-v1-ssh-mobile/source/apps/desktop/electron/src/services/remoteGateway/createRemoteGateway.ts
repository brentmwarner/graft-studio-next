import { createServer, type Server } from "node:http";
import {
  DEFAULT_MOBILE_CAPABILITIES,
  GRAFT_MOBILE_PROTOCOL_VERSION,
  GraftPairExchangeRequestSchema,
  GraftPushRegistrationRequestSchema,
  GraftPushUnregistrationRequestSchema,
} from "@graft/shared";
import { createCommandDispatcher } from "./commandDispatcher.js";
import { createEventJournal, type EventJournal } from "./eventJournal.js";
import {
  createPairingService,
  type PairingService,
  type PairingServiceDependencies,
} from "./pairingService.js";
import type {
  IssuedPairingCredential,
  RemoteGatewayConfig,
  RemoteGatewayEndpoint,
  RemoteGatewayHandlers,
} from "./types.js";
import {
  createWsSessionManager,
  type WsSessionManager,
} from "./wsSessionManager.js";

const MAX_JSON_BODY_BYTES = 64 * 1024;

/**
 * Graft desktop remote gateway.
 *
 * - HTTP: /v1/health, /v1/pair, /v1/snapshot
 * - WS:   /v1/ws (session-authenticated mobile control plane)
 *
 * Binds only to the configured host (loopback by default). Network binding
 * must be explicit via config.host.
 */
export type RemoteGateway = {
  config: RemoteGatewayConfig;
  server: Server;
  pairing: PairingService;
  journal: EventJournal;
  sessions: WsSessionManager;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  issuePairingCredential: (
    ttlMs?: number,
    endpoint?: RemoteGatewayEndpoint,
  ) => IssuedPairingCredential;
  revokeDevice: (deviceId: string) => void;
};

export function createRemoteGateway(
  config: RemoteGatewayConfig,
  handlers: RemoteGatewayHandlers,
  options?: { pairingDependencies?: PairingServiceDependencies },
): RemoteGateway {
  if (
    config.networkAccessEnabled === false &&
    config.host !== "127.0.0.1" &&
    config.host !== "localhost"
  ) {
    throw new Error(
      "remote gateway refuses non-loopback bind while networkAccessEnabled=false",
    );
  }

  const pairing = createPairingService(config, options?.pairingDependencies);
  const journal = createEventJournal();
  const dispatcher = createCommandDispatcher({
    handlers,
    journal,
    environment: {
      id: config.environmentId,
      label: config.environmentLabel,
    },
  });
  const sessions = createWsSessionManager({
    config,
    pairing,
    dispatcher,
    journal,
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${config.host}:${config.port}`);

    if (req.method === "GET" && url.pathname === "/v1/health") {
      writeJson(res, 200, {
        ok: true,
        service: "graft-remote-gateway",
        protocolVersion: GRAFT_MOBILE_PROTOCOL_VERSION,
        capabilities: DEFAULT_MOBILE_CAPABILITIES,
        environmentId: config.environmentId,
        environmentLabel: config.environmentLabel,
        networkAccessEnabled: config.networkAccessEnabled,
        cursor: journal.latestCursor(),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/pair") {
      const body = await readJsonSafely(req);
      const parsed = GraftPairExchangeRequestSchema.safeParse(body);
      if (!parsed.success) {
        writeJson(res, 400, {
          ok: false,
          error: {
            code: "validation_failed",
            message: "invalid_pairing_request",
          },
        });
        return;
      }

      const exchanged = pairing.exchangeToken(parsed.data);
      if (!exchanged.ok) {
        writeJson(res, exchanged.status, {
          ok: false,
          error: { code: exchanged.code, message: exchanged.message },
        });
        return;
      }

      writeJson(res, 200, { ok: true, session: exchanged.session });
      return;
    }

    if (url.pathname === "/v1/push-registration") {
      if (config.pushRegistrationEnabled !== true) {
        writeJson(res, 404, {
          ok: false,
          error: { code: "not_found", message: "not_found" },
        });
        return;
      }

      if (req.method === "PUT") {
        const session = authorizeHttp(req, pairing);
        if (!session) {
          writeJson(res, 401, {
            ok: false,
            error: {
              code: "authentication_required",
              message: "missing_or_invalid_bearer",
            },
          });
          return;
        }
        const body = await readJsonSafely(req);
        const parsed = GraftPushRegistrationRequestSchema.safeParse(body);
        if (!parsed.success) {
          writeJson(res, 400, {
            ok: false,
            error: {
              code: "validation_failed",
              message: "invalid_push_registration_request",
            },
          });
          return;
        }
        try {
          const registration = pairing.registerPushRegistration(
            session,
            parsed.data,
          );
          writeJson(res, 200, { ok: true, registration });
        } catch {
          writeJson(res, 503, {
            ok: false,
            error: {
              code: "secure_storage_unavailable",
              message: "push_registration_unavailable",
            },
          });
        }
        return;
      }

      if (req.method === "DELETE") {
        const session = authorizeHttp(req, pairing);
        if (!session) {
          writeJson(res, 401, {
            ok: false,
            error: {
              code: "authentication_required",
              message: "missing_or_invalid_bearer",
            },
          });
          return;
        }
        const decodedBody = await readJsonSafely(req);
        const body = decodedBody === null ? {} : decodedBody;
        if (!GraftPushUnregistrationRequestSchema.safeParse(body).success) {
          writeJson(res, 400, {
            ok: false,
            error: {
              code: "validation_failed",
              message: "invalid_push_unregistration_request",
            },
          });
          return;
        }
        const removed = pairing.unregisterPushRegistration(session);
        writeJson(res, 200, { ok: true, removed });
        return;
      }

      writeJson(res, 404, {
        ok: false,
        error: { code: "not_found", message: "not_found" },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/snapshot") {
      const session = authorizeHttp(req, pairing);
      if (!session) {
        writeJson(res, 401, {
          ok: false,
          error: {
            code: "authentication_required",
            message: "missing_or_invalid_bearer",
          },
        });
        return;
      }

      const threadId = url.searchParams.get("threadId") ?? undefined;
      const outcome = await dispatcher.dispatch({
        commandId: cryptoRandomUuid(),
        command: { type: "snapshot.get", threadId },
      });
      if (outcome.result?.type !== "snapshot.get.result") {
        writeJson(res, 500, {
          ok: false,
          error: {
            code: "internal",
            message: outcome.receipt.message ?? "snapshot_failed",
          },
        });
        return;
      }

      const snapshot = {
        ...outcome.result.snapshot,
        environment: {
          ...outcome.result.snapshot.environment,
          id: config.environmentId,
          label: config.environmentLabel,
        },
      };
      writeJson(res, 200, snapshot);
      return;
    }

    writeJson(res, 404, {
      ok: false,
      error: { code: "not_found", message: "not_found" },
    });
  });

  sessions.attach(server);

  return {
    config,
    server,
    pairing,
    journal,
    sessions,
    async start() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => resolve());
      });
    },
    async stop() {
      await sessions.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
    issuePairingCredential(ttlMs, endpoint) {
      return pairing.issuePairingCredential(ttlMs, endpoint);
    },
    revokeDevice(deviceId) {
      pairing.revokeDevice(deviceId);
      sessions.disconnectDevice(deviceId);
    },
  };
}

function authorizeHttp(
  req: import("node:http").IncomingMessage,
  pairing: PairingService,
) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return pairing.getSessionByBearer(auth.slice("Bearer ".length));
}

function writeJson(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(
  req: import("node:http").IncomingMessage,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(buffer);
  }
  if (tooLarge) throw new Error("JSON request body exceeds limit");
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function readJsonSafely(
  req: import("node:http").IncomingMessage,
): Promise<unknown> {
  try {
    return await readJson(req);
  } catch {
    return undefined;
  }
}

function cryptoRandomUuid(): `${string}-${string}-${string}-${string}-${string}` {
  return globalThis.crypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`;
}
