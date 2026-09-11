import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  DesktopHostProtocol,
  DesktopHostStore,
  type DesktopHostAuthorizationDecision,
  type DesktopHostAuthorizationInput,
  type DesktopHostConnection,
} from "@graft/host-runtime";
import {
  GRAFT_DESKTOP_ENDPOINTS,
  GRAFT_DESKTOP_PROTOCOL_VERSION,
  GraftDesktopEnrollmentRequestSchema,
  GraftDesktopJsonValueSchema,
  GraftDesktopHealthSchema,
  GraftDesktopHostMessageSchema,
  type GraftDesktopCapability,
  type GraftDesktopHealth,
  type GraftDesktopJsonValue,
  type GraftDesktopPlatform,
  type GraftDesktopSessionRecord,
  type GraftDesktopStreamChannel,
  type GraftDesktopStreamFrame,
} from "@graft/shared";
import {
  BulkTransferStore,
  MAX_BULK_TRANSFER_BYTES,
} from "./bulkTransferStore.js";
import { GRAFT_HOST_SERVICE, GRAFT_HOST_VERSION } from "./constants.js";
import { defaultEnvironmentLabel } from "./hostPaths.js";
import { requireSupportedHostPlatform } from "./hostPlatform.js";
import {
  prepareUploadedCommand,
  type PreparedUploadedCommand,
} from "./uploadedCommandHandoff.js";

const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_SOCKET_PAYLOAD_BYTES = 8 * 1024 * 1024;

export interface GraftHostActivity {
  activeRunCount: number;
  activePtyCount: number;
}

export interface GraftHostServerOptions {
  databasePath: string;
  bulkRoot?: string;
  environmentLabel?: string;
  daemonVersion?: string;
  port?: number;
  platform?: GraftDesktopPlatform;
  capabilities?: readonly GraftDesktopCapability[];
  enrollmentGrants?: readonly GraftDesktopCapability[];
  getActivity?: () => GraftHostActivity;
  authorizeCommand?: (
    input: DesktopHostAuthorizationInput,
  ) => DesktopHostAuthorizationDecision;
  dispatchCommand?: (
    session: GraftDesktopSessionRecord,
    command: { type: string; payload?: GraftDesktopJsonValue },
  ) => Promise<GraftDesktopJsonValue | undefined>;
}

export interface GraftHostEnvironmentEvent {
  channel: string;
  payload?: GraftDesktopJsonValue;
}

function rejectAllCommands(): DesktopHostAuthorizationDecision {
  return {
    allowed: false,
    reason: "The host command runtime is not installed",
  };
}

async function rejectCommand(): Promise<never> {
  throw new Error("The host command runtime is not installed");
}

function parseBearer(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const bearer = header.slice("Bearer ".length).trim();
  return bearer.length > 0 ? bearer : null;
}

function requestPath(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_JSON_BODY_BYTES) {
      throw new Error("Request body exceeds the desktop host limit");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new Error("Request body is required");
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function readBinaryBody(
  request: IncomingMessage,
  limit = MAX_BULK_TRANSFER_BYTES,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > limit) throw new Error("Bulk transfer exceeds the host limit");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function bulkTransferId(path: string): string | null {
  const prefix = `${GRAFT_DESKTOP_ENDPOINTS.bulk}/`;
  if (!path.startsWith(prefix)) return null;
  const transferId = path.slice(prefix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    transferId,
  )
    ? transferId
    : null;
}

function streamChannelForEvent(
  channel: string,
): GraftDesktopStreamChannel | null {
  const normalized = channel.toLowerCase();
  if (normalized.includes("terminal") || normalized.includes("pty")) {
    return "pty";
  }
  if (normalized.includes("file") && normalized.includes("watch")) {
    return "file_watch";
  }
  if (normalized.includes("lsp")) return "lsp";
  if (normalized.includes("progress")) return "progress";
  if (normalized.includes(":worker:") || normalized.startsWith("worker:")) {
    return "worker";
  }
  return null;
}

function sendSocketMessage(socket: WebSocket, value: unknown): void {
  const parsed = GraftDesktopHostMessageSchema.parse(value);
  socket.send(JSON.stringify(parsed));
}

export class GraftHostServer {
  private readonly httpServer = createServer((request, response) => {
    void this.handleHttp(request, response);
  });

  private readonly socketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_SOCKET_PAYLOAD_BYTES,
  });

  private readonly environmentLabel: string;
  private readonly daemonVersion: string;
  private readonly platform: GraftDesktopPlatform;
  private readonly capabilities: readonly GraftDesktopCapability[];
  private readonly enrollmentGrants: readonly GraftDesktopCapability[];
  private readonly getActivity: () => GraftHostActivity;
  private readonly bulkTransfers: BulkTransferStore;
  private readonly connections = new Map<WebSocket, DesktopHostConnection>();
  private readonly streamState = new Map<
    string,
    { streamId: string; sequence: number }
  >();
  private store: DesktopHostStore | null = null;
  private protocol: DesktopHostProtocol | null = null;
  private listenPort: number | null = null;

  constructor(private readonly options: GraftHostServerOptions) {
    this.environmentLabel =
      options.environmentLabel ?? defaultEnvironmentLabel();
    this.daemonVersion = options.daemonVersion ?? GRAFT_HOST_VERSION;
    this.platform = options.platform ?? requireSupportedHostPlatform();
    this.capabilities = options.capabilities ?? ["diagnostics"];
    this.enrollmentGrants = options.enrollmentGrants ?? this.capabilities;
    this.getActivity =
      options.getActivity ?? (() => ({ activeRunCount: 0, activePtyCount: 0 }));
    this.bulkTransfers = new BulkTransferStore(
      options.bulkRoot ?? join(dirname(options.databasePath), "bulk"),
    );

    this.httpServer.on("upgrade", (request, socket, head) => {
      if (requestPath(request) !== GRAFT_DESKTOP_ENDPOINTS.socket) {
        socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        return;
      }
      const bearer = parseBearer(request);
      if (!bearer || !this.requireStore().authenticateBearer(bearer)) {
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        return;
      }
      this.socketServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.attachSocket(webSocket, bearer);
      });
    });
  }

  async start(): Promise<number> {
    if (this.listenPort !== null) return this.listenPort;
    this.store = new DesktopHostStore(this.options.databasePath);
    this.store.getOrCreateIdentity(this.environmentLabel);
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          this.httpServer.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          this.httpServer.off("error", onError);
          resolve();
        };
        this.httpServer.once("error", onError);
        this.httpServer.once("listening", onListening);
        this.httpServer.listen(this.options.port ?? 0, "127.0.0.1");
      });
    } catch (error) {
      this.store.close();
      this.store = null;
      throw error;
    }
    const address = this.httpServer.address();
    if (!address || typeof address === "string") {
      await this.close();
      throw new Error("graft-host did not receive a TCP listen address");
    }
    this.listenPort = (address as AddressInfo).port;
    this.protocol = new DesktopHostProtocol(this.requireStore(), {
      environmentLabel: this.environmentLabel,
      daemonVersion: this.daemonVersion,
      port: this.listenPort,
      platform: this.platform,
      capabilities: this.capabilities,
      enrollmentGrants: this.enrollmentGrants,
      getActivity: this.getActivity,
      authorizeCommand: this.options.authorizeCommand ?? rejectAllCommands,
      dispatchCommand: this.options.dispatchCommand ?? rejectCommand,
    });
    return this.listenPort;
  }

  address(): { host: "127.0.0.1"; port: number } {
    if (this.listenPort === null) throw new Error("graft-host is not running");
    return { host: "127.0.0.1", port: this.listenPort };
  }

  bootstrap() {
    return this.requireProtocol().bootstrap();
  }

  publishEnvironmentEvent(rawEvent: GraftHostEnvironmentEvent): void {
    const event = GraftDesktopJsonValueSchema.parse({
      channel: rawEvent.channel,
      ...(rawEvent.payload === undefined ? {} : { payload: rawEvent.payload }),
    });
    const streamChannel = streamChannelForEvent(rawEvent.channel);
    if (streamChannel) {
      const prior = this.streamState.get(rawEvent.channel);
      const next = prior ?? { streamId: randomUUID(), sequence: 0 };
      const frame: GraftDesktopStreamFrame = {
        envelope: "stream",
        streamId: next.streamId,
        channel: streamChannel,
        sequence: next.sequence,
        payload: event,
      };
      this.streamState.set(rawEvent.channel, {
        ...next,
        sequence: next.sequence + 1,
      });
      this.broadcast(frame);
      return;
    }
    const stored = this.requireStore().appendEvent(event);
    this.broadcast({
      envelope: "event",
      cursor: stored.cursor,
      occurredAt: stored.occurredAt,
      event: stored.event,
    });
  }

  createBulkDownload(sessionId: string, data: Buffer, mediaType: string) {
    return this.bulkTransfers.createDownload(sessionId, data, mediaType);
  }

  uploadedBulkPath(sessionId: string, transferId: string): string | null {
    return this.bulkTransfers.uploadedPath(sessionId, transferId);
  }

  prepareUploadedCommand(
    sessionId: string,
    command: { type: string; payload?: GraftDesktopJsonValue },
  ): PreparedUploadedCommand {
    return prepareUploadedCommand(command, (transferId, fileName) =>
      this.bulkTransfers.claimUpload(sessionId, transferId, fileName),
    );
  }

  health(): GraftDesktopHealth {
    const store = this.requireStore();
    const identity = store.getOrCreateIdentity(this.environmentLabel);
    const replay = store.getReplayState();
    return GraftDesktopHealthSchema.parse({
      service: GRAFT_HOST_SERVICE,
      protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
      daemonVersion: this.daemonVersion,
      environmentId: identity.environmentId,
      environmentLabel: identity.environmentLabel,
      platform: this.platform,
      port: this.address().port,
      capabilities: [...this.capabilities],
      ...replay,
      ...this.getActivity(),
    });
  }

  async close(): Promise<void> {
    for (const client of this.socketServer.clients) client.terminate();
    if (this.httpServer.listening) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    this.store?.close();
    this.connections.clear();
    this.bulkTransfers.close();
    this.store = null;
    this.protocol = null;
    this.listenPort = null;
  }

  private async handleHttp(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const path = requestPath(request);
    if (request.method === "GET" && path === GRAFT_DESKTOP_ENDPOINTS.health) {
      sendJson(response, 200, this.health());
      return;
    }
    if (request.method === "POST" && path === GRAFT_DESKTOP_ENDPOINTS.enroll) {
      try {
        const body = GraftDesktopEnrollmentRequestSchema.parse(
          await readJsonBody(request),
        );
        const enrolled = this.requireProtocol().enroll(body);
        if (!enrolled) {
          sendJson(response, 401, {
            error: "Enrollment token is invalid, expired, or already used",
          });
          return;
        }
        sendJson(response, 200, enrolled);
      } catch {
        sendJson(response, 400, { error: "Invalid enrollment request" });
      }
      return;
    }
    if (
      request.method === "DELETE" &&
      path === GRAFT_DESKTOP_ENDPOINTS.session
    ) {
      const bearer = parseBearer(request);
      const session = bearer
        ? this.requireStore().authenticateBearer(bearer)
        : null;
      if (!session) {
        sendJson(response, 401, { error: "Unauthorized" });
        return;
      }
      this.requireStore().revokeSession(session.sessionId);
      for (const [socket, connection] of this.connections) {
        if (connection.session.sessionId === session.sessionId) {
          socket.close(1008, "Desktop host session revoked");
        }
      }
      sendJson(response, 200, { ok: true });
      return;
    }
    if (
      path === GRAFT_DESKTOP_ENDPOINTS.bulk ||
      path.startsWith(`${GRAFT_DESKTOP_ENDPOINTS.bulk}/`)
    ) {
      const bearer = parseBearer(request);
      const session = bearer
        ? this.requireStore().authenticateBearer(bearer)
        : null;
      if (!session || !session.grants.includes("bulk_transfer")) {
        sendJson(response, 401, { error: "Unauthorized" });
        return;
      }
      if (request.method === "POST" && path === GRAFT_DESKTOP_ENDPOINTS.bulk) {
        try {
          const ticket = this.bulkTransfers.createUpload(
            session.sessionId,
            await readJsonBody(request),
          );
          sendJson(response, 201, { ok: true, ticket });
        } catch {
          sendJson(response, 400, { error: "Invalid bulk upload request" });
        }
        return;
      }
      const transferId = bulkTransferId(path);
      if (!transferId) {
        sendJson(response, 404, { error: "Transfer not found" });
        return;
      }
      if (request.method === "PUT") {
        try {
          const ticket = this.bulkTransfers.storeUpload(
            session.sessionId,
            transferId,
            await readBinaryBody(request),
          );
          if (!ticket) {
            sendJson(response, 422, {
              error: "Transfer size or digest did not match the ticket",
            });
            return;
          }
          sendJson(response, 200, { ok: true, ticket });
        } catch {
          sendJson(response, 413, { error: "Bulk upload is too large" });
        }
        return;
      }
      if (request.method === "GET") {
        const download = this.bulkTransfers.readDownload(
          session.sessionId,
          transferId,
        );
        if (!download) {
          sendJson(response, 404, { error: "Transfer not found" });
          return;
        }
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-length": download.ticket.sizeBytes,
          "content-type": download.ticket.mediaType,
          "x-graft-sha256": download.ticket.sha256,
        });
        response.end(download.data);
        return;
      }
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  }

  private attachSocket(socket: WebSocket, bearer: string): void {
    let connection: DesktopHostConnection | null = null;
    let queue = Promise.resolve();
    socket.on("message", (data, isBinary) => {
      queue = queue
        .then(async () => {
          if (isBinary)
            throw new Error("Binary control messages are not supported");
          const raw = JSON.parse(data.toString()) as unknown;
          if (!connection) {
            const opened = this.requireProtocol().open(bearer, raw);
            if (!opened.ok) {
              sendSocketMessage(socket, {
                envelope: "error",
                error: opened.error,
              });
              socket.close(1008, "Desktop host session rejected");
              return;
            }
            connection = opened.connection;
            this.connections.set(socket, connection);
            for (const message of opened.messages)
              sendSocketMessage(socket, message);
            return;
          }
          const messages = await this.requireProtocol().handle(connection, raw);
          for (const message of messages) sendSocketMessage(socket, message);
        })
        .catch(() => {
          if (socket.readyState === 1) {
            sendSocketMessage(socket, {
              envelope: "error",
              error: {
                code: "invalid_command",
                message: "The desktop host message could not be processed",
                retryable: false,
              },
            });
            socket.close(1003, "Invalid desktop host message");
          }
        });
    });
    socket.once("close", () => {
      this.connections.delete(socket);
    });
  }

  private broadcast(message: unknown): void {
    for (const [socket, connection] of this.connections) {
      if (
        socket.readyState !== 1 ||
        !this.requireStore().getActiveSession(connection.session.sessionId)
      ) {
        continue;
      }
      sendSocketMessage(socket, message);
    }
  }

  private requireStore(): DesktopHostStore {
    if (!this.store) throw new Error("graft-host is not running");
    return this.store;
  }

  private requireProtocol(): DesktopHostProtocol {
    if (!this.protocol) throw new Error("graft-host is not running");
    return this.protocol;
  }
}
