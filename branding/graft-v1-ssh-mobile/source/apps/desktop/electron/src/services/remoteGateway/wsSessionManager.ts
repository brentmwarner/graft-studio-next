import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  DEFAULT_MOBILE_CAPABILITIES,
  GRAFT_MOBILE_PROTOCOL_VERSION,
  GraftMobileClientMessageSchema,
  type GraftMobileHostMessage,
  type GraftSessionCredential,
  type GraftTimelineEvent,
} from "@graft/shared";
import type { CommandDispatcher } from "./commandDispatcher.js";
import type { EventJournal } from "./eventJournal.js";
import type { PairingService } from "./pairingService.js";
import type { RemoteGatewayConfig } from "./types.js";

const MAX_OUTBOUND_QUEUE = 256;

type ClientSession = {
  ws: WebSocket;
  session: GraftSessionCredential;
  queue: GraftMobileHostMessage[];
  /** Frames handed to `ws.send` whose write callback has not fired yet. */
  inFlight: number;
  alive: boolean;
};

export type WsSessionManager = {
  attach: (server: HttpServer) => void;
  broadcastEvent: (event: GraftTimelineEvent) => void;
  activeDeviceIds: () => Set<string>;
  disconnectSession: (sessionId: string, reason?: string) => void;
  disconnectDevice: (deviceId: string) => void;
  close: () => Promise<void>;
};

export function createWsSessionManager(input: {
  config: RemoteGatewayConfig;
  pairing: PairingService;
  dispatcher: CommandDispatcher;
  journal: EventJournal;
}): WsSessionManager {
  let wss: WebSocketServer | null = null;
  const clients = new Map<WebSocket, ClientSession>();

  function send(client: ClientSession, message: GraftMobileHostMessage) {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    if (client.inFlight >= MAX_OUTBOUND_QUEUE) {
      const backpressure: GraftMobileHostMessage = {
        envelope: "snapshot_required",
        reason: "backpressure",
        message: "outbound_queue_overflow",
      };
      client.ws.send(JSON.stringify(backpressure));
      client.ws.close(1013, "backpressure");
      return;
    }
    client.queue.push(message);
    flush(client);
  }

  // `ws.send` is asynchronous, so a frame is only truly delivered once its
  // callback fires. Counting frames handed to the socket — rather than frames
  // still sitting in `queue` — is what makes the overflow guard above
  // meaningful for a slow or suspended client; otherwise the queue drains
  // instantly on every call and the limit never trips.
  function flush(client: ClientSession) {
    while (client.queue.length > 0 && client.ws.readyState === WebSocket.OPEN) {
      const next = client.queue.shift();
      if (!next) break;
      client.inFlight += 1;
      client.ws.send(JSON.stringify(next), () => {
        client.inFlight = Math.max(0, client.inFlight - 1);
      });
    }
  }

  async function handleMessage(client: ClientSession, raw: WebSocket.RawData) {
    let json: unknown;
    try {
      json = JSON.parse(String(raw));
    } catch {
      send(client, {
        envelope: "error",
        error: { code: "validation_failed", message: "invalid_json" },
      });
      return;
    }

    const parsed = GraftMobileClientMessageSchema.safeParse(json);
    if (!parsed.success) {
      send(client, {
        envelope: "error",
        error: { code: "validation_failed", message: "invalid_frame" },
      });
      return;
    }

    const frame = parsed.data;
    switch (frame.envelope) {
      case "hello": {
        if (frame.sessionId !== client.session.sessionId) {
          send(client, {
            envelope: "error",
            error: {
              code: "authentication_required",
              message: "session_mismatch",
            },
          });
          client.ws.close(1008, "session_mismatch");
          return;
        }
        // The client treats the first frame after `hello` as the welcome and
        // drops the connection otherwise, so complete the handshake before any
        // replay frames — otherwise a reconnect that has events to replay
        // (the common case) fails and retries forever.
        send(client, {
          envelope: "welcome",
          protocolVersion: GRAFT_MOBILE_PROTOCOL_VERSION,
          capabilities: [...DEFAULT_MOBILE_CAPABILITIES],
          environmentId: input.config.environmentId,
          environmentLabel: input.config.environmentLabel,
          cursor: input.journal.latestCursor(),
        });
        if (frame.afterCursor !== undefined) {
          const replay = input.journal.replayAfter(frame.afterCursor);
          if (replay.snapshotRequired) {
            send(client, {
              envelope: "snapshot_required",
              reason: "cursor_expired",
            });
          } else {
            for (const event of replay.events) {
              send(client, { envelope: "event", event });
            }
          }
        }
        return;
      }
      case "ping": {
        send(client, { envelope: "pong", at: frame.at });
        return;
      }
      case "subscribe": {
        if (frame.afterCursor !== undefined) {
          const replay = input.journal.replayAfter(frame.afterCursor);
          if (replay.snapshotRequired) {
            send(client, {
              envelope: "snapshot_required",
              reason: "cursor_expired",
            });
          } else {
            for (const event of replay.events) {
              send(client, { envelope: "event", event });
            }
          }
        }
        return;
      }
      case "command": {
        const live = input.pairing.getSessionById(client.session.sessionId);
        if (!live) {
          send(client, {
            envelope: "error",
            error: {
              code: "device_revoked",
              message: "session_revoked",
            },
          });
          client.ws.close(1008, "revoked");
          return;
        }
        const outcome = await input.dispatcher.dispatch({
          commandId: frame.commandId,
          requestId: frame.requestId,
          command: frame.command,
        });
        send(client, {
          envelope: "response",
          commandId: frame.commandId,
          requestId: frame.requestId,
          receipt: outcome.receipt,
          result: outcome.result,
        });
        return;
      }
      default: {
        const _exhaustive: never = frame;
        return _exhaustive;
      }
    }
  }

  return {
    attach(server) {
      wss = new WebSocketServer({ noServer: true });

      server.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url ?? "/", `http://${input.config.host}`);
        if (url.pathname !== "/v1/ws") {
          socket.destroy();
          return;
        }

        const session = authorizeUpgrade(req, input.pairing);
        if (!session) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        wss!.handleUpgrade(req, socket, head, (ws) => {
          const client: ClientSession = {
            ws,
            session,
            queue: [],
            inFlight: 0,
            alive: true,
          };
          clients.set(ws, client);
          ws.on("message", (data) => {
            void handleMessage(client, data);
          });
          ws.on("close", () => {
            clients.delete(ws);
          });
          ws.on("error", () => {
            clients.delete(ws);
          });
        });
      });
    },

    broadcastEvent(event) {
      for (const client of clients.values()) {
        send(client, { envelope: "event", event });
      }
    },

    activeDeviceIds() {
      const deviceIds = new Set<string>();
      for (const client of clients.values()) {
        if (client.ws.readyState === WebSocket.OPEN) {
          deviceIds.add(client.session.deviceId);
        }
      }
      return deviceIds;
    },

    disconnectSession(sessionId, reason = "revoked") {
      for (const [ws, client] of clients) {
        if (client.session.sessionId === sessionId) {
          send(client, {
            envelope: "error",
            error: { code: "device_revoked", message: reason },
          });
          ws.close(1008, reason);
          clients.delete(ws);
        }
      }
    },

    disconnectDevice(deviceId) {
      for (const [ws, client] of clients) {
        if (client.session.deviceId === deviceId) {
          send(client, {
            envelope: "error",
            error: { code: "device_revoked", message: "device_revoked" },
          });
          ws.close(1008, "device_revoked");
          clients.delete(ws);
        }
      }
    },

    async close() {
      for (const ws of clients.keys()) {
        ws.close(1001, "gateway_stop");
      }
      clients.clear();
      await new Promise<void>((resolve) => {
        if (!wss) {
          resolve();
          return;
        }
        wss.close(() => resolve());
      });
      wss = null;
    },
  };
}

function authorizeUpgrade(
  req: IncomingMessage,
  pairing: PairingService,
): GraftSessionCredential | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return pairing.getSessionByBearer(auth.slice("Bearer ".length));
}
