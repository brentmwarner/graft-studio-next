import { createHash, randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import {
  GRAFT_DESKTOP_CAPABILITIES,
  GRAFT_DESKTOP_ENDPOINTS,
  GRAFT_DESKTOP_PROTOCOL_VERSION,
  GraftDesktopBulkTransferTicketSchema,
  GraftDesktopBulkUploadResultSchema,
  GraftDesktopClientMessageSchema,
  GraftDesktopHostMessageSchema,
  GraftDesktopJsonValueSchema,
  assertNeverDesktop,
  type GraftDesktopBulkTransferTicket,
  type GraftDesktopCapability,
  type GraftDesktopClientMessage,
  type GraftDesktopHostMessage,
  type GraftDesktopJsonValue,
} from "@graft/shared";
import type { EnvironmentEventSink } from "@graft/host-runtime";
import type { SshRemoteConnection } from "../services/sshRemote";
import { workerForViewChannel } from "../types/ipc";
import type { ViewCommand } from "./channels";
import type { ClientPlatformCommandPort } from "./localEnvironmentClient";
import type { EnvironmentClient } from "./environmentClient";
import { DESKTOP_COMMAND_POLICIES } from "./desktopCommandOwnership";
import {
  sanitizeLegacyCursorPartEvent,
  sanitizeLegacyCursorPartsResponse,
  type LegacyCursorTurnContext,
} from "./legacyCursorStream";

interface PendingCommand {
  envelope: GraftDesktopClientMessage & { envelope: "command" };
  command: ViewCommand;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export interface RemoteEnvironmentClientOptions {
  clientVersion: string;
  createSocket?: (connection: SshRemoteConnection) => WebSocket;
  handshakeTimeoutMs?: number;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  fetch?: typeof fetch;
  onFatalError?: (error: Error) => void;
}

function asDesktopJson(value: unknown): GraftDesktopJsonValue {
  if (value === undefined) return null;
  return GraftDesktopJsonValueSchema.parse(
    JSON.parse(JSON.stringify(value)) as unknown,
  );
}

function remoteError(message: string): Error {
  return new Error(`Remote environment: ${message}`);
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function uploadReference(transferId: string, fileName: string): string {
  return `graft-upload://${transferId}/${encodeURIComponent(fileName)}`;
}

/** Reconnectable desktop-host adapter that can be attached to the active app window. */
export class RemoteEnvironmentClient implements EnvironmentClient {
  private readonly sinks = new Set<EnvironmentEventSink>();
  private readonly pending = new Map<string, PendingCommand>();
  private readonly ready: Promise<void>;
  private readonly streamSequences = new Map<string, number>();
  private readonly cursorThreadIds = new Set<string>();
  private readonly cursorTurns = new Map<string, LegacyCursorTurnContext>();
  private negotiatedCapabilities = new Set<GraftDesktopCapability>();
  private socket: WebSocket | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private socketGeneration = 0;
  private lastCursor: number;
  private connected = false;
  private closed = false;

  private constructor(
    private readonly connection: SshRemoteConnection,
    private readonly clientPlatform: ClientPlatformCommandPort,
    private readonly options: RemoteEnvironmentClientOptions,
  ) {
    this.lastCursor = connection.environment.cursor;
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.openSocket();
  }

  static async connect(
    connection: SshRemoteConnection,
    clientPlatform: ClientPlatformCommandPort,
    options: RemoteEnvironmentClientOptions,
  ): Promise<RemoteEnvironmentClient> {
    const client = new RemoteEnvironmentClient(
      connection,
      clientPlatform,
      options,
    );
    await client.waitUntilReady();
    return client;
  }

  subscribe(sink: EnvironmentEventSink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  async dispatch(command: ViewCommand): Promise<unknown> {
    this.observeCommand(command);
    const policy = DESKTOP_COMMAND_POLICIES[command.type];
    switch (policy.owner) {
      case "client":
        return this.clientPlatform.dispatch(command);
      case "host": {
        if (
          !policy.capability ||
          !this.negotiatedCapabilities.has(policy.capability)
        ) {
          throw remoteError(
            `the host did not grant ${policy.capability ?? command.type}`,
          );
        }
        return this.dispatchHost(command);
      }
      case "split":
        return this.dispatchSplit(command);
      case "unsupported_remote":
        throw remoteError(`${command.type} is only available on this machine`);
      default: {
        const exhaustive: never = policy.owner;
        throw remoteError(`unknown command owner ${String(exhaustive)}`);
      }
    }
  }

  async uploadBulk(
    data: Uint8Array,
    mediaType: string,
  ): Promise<GraftDesktopBulkTransferTicket> {
    if (!this.negotiatedCapabilities.has("bulk_transfer")) {
      throw remoteError("the host did not grant bulk_transfer");
    }
    const fetchImpl = this.options.fetch ?? fetch;
    const createResponse = await fetchImpl(
      `${this.connection.routes.httpBaseUrl}${GRAFT_DESKTOP_ENDPOINTS.bulk}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.connection.bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation: "create_upload",
          mediaType,
          sizeBytes: data.byteLength,
          sha256: sha256(data),
        }),
      },
    );
    if (!createResponse.ok) throw remoteError("upload ticket was rejected");
    const created = GraftDesktopBulkUploadResultSchema.parse(
      await createResponse.json(),
    );
    const uploadResponse = await fetchImpl(
      `${this.connection.routes.httpBaseUrl}${GRAFT_DESKTOP_ENDPOINTS.bulk}/${created.ticket.transferId}`,
      {
        method: "PUT",
        headers: { authorization: `Bearer ${this.connection.bearer}` },
        body: Buffer.from(data),
      },
    );
    if (!uploadResponse.ok) throw remoteError("upload bytes were rejected");
    return created.ticket;
  }

  async downloadBulk(ticket: GraftDesktopBulkTransferTicket): Promise<Buffer> {
    const parsed = GraftDesktopBulkTransferTicketSchema.parse(ticket);
    if (parsed.direction !== "download") {
      throw remoteError("a download ticket is required");
    }
    const fetchImpl = this.options.fetch ?? fetch;
    const response = await fetchImpl(
      `${this.connection.routes.httpBaseUrl}${GRAFT_DESKTOP_ENDPOINTS.bulk}/${parsed.transferId}`,
      { headers: { authorization: `Bearer ${this.connection.bearer}` } },
    );
    if (!response.ok) throw remoteError("download was rejected");
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length !== parsed.sizeBytes || sha256(data) !== parsed.sha256) {
      throw remoteError("download size or digest did not match its ticket");
    }
    return data;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const error = remoteError("connection closed");
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    this.rejectOutstanding(error);
    this.socket?.close();
    this.socket = null;
    await this.connection.close();
  }

  private async waitUntilReady(): Promise<void> {
    const timeoutMs = this.options.handshakeTimeoutMs ?? 5_000;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.ready,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(remoteError("host handshake timed out")),
            timeoutMs,
          );
        }),
      ]);
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private openSocket(): void {
    if (this.closed) return;
    const generation = ++this.socketGeneration;
    const socket =
      this.options.createSocket?.(this.connection) ??
      new WebSocket(this.connection.routes.wsUrl, {
        headers: { authorization: `Bearer ${this.connection.bearer}` },
      });
    this.socket = socket;
    socket.on("open", () => {
      if (generation !== this.socketGeneration || this.closed) return;
      const hello = GraftDesktopClientMessageSchema.parse({
        envelope: "hello",
        protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
        clientVersion: this.options.clientVersion,
        capabilities: GRAFT_DESKTOP_CAPABILITIES,
        afterCursor: this.lastCursor,
      });
      socket.send(JSON.stringify(hello));
    });
    socket.on("message", (data: RawData, isBinary: boolean) => {
      if (generation !== this.socketGeneration || this.closed) return;
      if (isBinary) {
        this.failProtocol(remoteError("binary control message received"));
        return;
      }
      try {
        const message = GraftDesktopHostMessageSchema.parse(
          JSON.parse(data.toString()) as unknown,
        );
        this.handleMessage(message);
      } catch {
        this.failProtocol(remoteError("invalid host message received"));
      }
    });
    socket.on("error", () => {
      this.handleDisconnect(generation);
    });
    socket.on("close", () => {
      this.handleDisconnect(generation);
    });
  }

  private handleMessage(message: GraftDesktopHostMessage): void {
    switch (message.envelope) {
      case "welcome":
        if (
          message.environment.environmentId !==
          this.connection.environment.environmentId
        ) {
          this.failProtocol(remoteError("host identity changed"));
          return;
        }
        this.negotiatedCapabilities = new Set(message.capabilities);
        this.connected = true;
        this.reconnectAttempt = 0;
        this.resolveReady?.();
        this.resolveReady = null;
        this.rejectReady = null;
        this.emitConnectionState("connected");
        for (const pending of this.pending.values()) {
          this.sendCommand(pending.envelope);
        }
        return;
      case "response": {
        const pending = this.pending.get(message.commandId);
        if (!pending) return;
        this.pending.delete(message.commandId);
        if (message.error) pending.reject(remoteError(message.error.message));
        else
          pending.resolve(
            this.processHostResponse(pending.command, message.result),
          );
        return;
      }
      case "event":
        if (message.cursor <= this.lastCursor) return;
        this.lastCursor = message.cursor;
        this.emitHostEvent(message.event);
        return;
      case "stream": {
        const prior = this.streamSequences.get(message.streamId);
        if (prior !== undefined && message.sequence <= prior) return;
        if (prior !== undefined && message.sequence > prior + 1) {
          this.emitToSinks(workerForViewChannel("terminal"), {
            type: "desktop-host/stream-gap",
            payload: {
              streamId: message.streamId,
              channel: message.channel,
              expectedSequence: prior + 1,
              receivedSequence: message.sequence,
            },
          });
        }
        this.streamSequences.set(message.streamId, message.sequence);
        this.emitHostEvent(message.payload);
        if (message.eof) this.streamSequences.delete(message.streamId);
        return;
      }
      case "error": {
        if (message.error.commandId) {
          const pending = this.pending.get(message.error.commandId);
          if (pending) {
            this.pending.delete(message.error.commandId);
            pending.reject(remoteError(message.error.message));
          }
          return;
        }
        this.failProtocol(remoteError(message.error.message));
        return;
      }
      case "snapshot_required":
        this.lastCursor = Math.max(this.lastCursor, message.replayFloor);
        this.emitToSinks(workerForViewChannel("engine"), {
          type: "desktop-host/snapshot-required",
          payload: {
            reason: message.reason,
            replayFloor: message.replayFloor,
          },
        });
        return;
      case "receipt":
      case "pong":
        return;
      default:
        assertNeverDesktop(message);
    }
  }

  private emitHostEvent(event: GraftDesktopJsonValue): void {
    const compatibleEvent = sanitizeLegacyCursorPartEvent(
      event,
      this.cursorTurns,
    );
    if (
      compatibleEvent === null ||
      Array.isArray(compatibleEvent) ||
      typeof compatibleEvent !== "object" ||
      typeof compatibleEvent.channel !== "string"
    ) {
      return;
    }
    const payload = Object.prototype.hasOwnProperty.call(
      compatibleEvent,
      "payload",
    )
      ? compatibleEvent.payload
      : null;
    this.emitToSinks(compatibleEvent.channel, payload);
    this.finishCompatibleTurn(compatibleEvent);
  }

  private observeCommand(command: ViewCommand): void {
    switch (command.type) {
      case "thread/create":
      case "thread/update":
        if (command.payload.providerHint === "cursor") {
          const threadId =
            command.type === "thread/update"
              ? command.payload.threadId
              : undefined;
          if (threadId) this.cursorThreadIds.add(threadId);
        } else if (
          command.type === "thread/update" &&
          command.payload.providerHint !== undefined
        ) {
          this.cursorThreadIds.delete(command.payload.threadId);
        }
        return;
      case "turn/start": {
        const isCursor =
          command.payload.providerHint === "cursor" ||
          (command.payload.providerHint === undefined &&
            this.cursorThreadIds.has(command.payload.threadId));
        if (isCursor) {
          this.cursorThreadIds.add(command.payload.threadId);
          this.cursorTurns.set(command.payload.threadId, {
            prompt: command.payload.text,
          });
        }
        return;
      }
      default:
        return;
    }
  }

  private processHostResponse(command: ViewCommand, result: unknown): unknown {
    if (command.type === "thread/list") {
      this.observeThreadRows(result);
      return result;
    }
    if (command.type === "thread/create") {
      this.observeThreadRows(result);
      return result;
    }
    if (
      (command.type === "thread/parts" ||
        command.type === "thread/parts/page") &&
      this.cursorThreadIds.has(command.payload.threadId)
    ) {
      return sanitizeLegacyCursorPartsResponse(result);
    }
    return result;
  }

  private observeThreadRows(value: unknown): void {
    const rows = Array.isArray(value) ? value : [value];
    for (const row of rows) {
      if (
        row === null ||
        Array.isArray(row) ||
        typeof row !== "object" ||
        typeof row.id !== "string"
      ) {
        continue;
      }
      if (row.providerHint === "cursor") this.cursorThreadIds.add(row.id);
      else if (typeof row.providerHint === "string") {
        this.cursorThreadIds.delete(row.id);
      }
    }
  }

  private finishCompatibleTurn(
    event: Record<string, GraftDesktopJsonValue>,
  ): void {
    const payload = event.payload;
    if (!payload || Array.isArray(payload) || typeof payload !== "object") {
      return;
    }
    const nested = payload.payload;
    if (
      payload.type === "part:event" &&
      nested &&
      !Array.isArray(nested) &&
      typeof nested === "object" &&
      nested.type === "part:turn_complete" &&
      typeof nested.threadId === "string"
    ) {
      this.cursorTurns.delete(nested.threadId);
    }
  }

  private emitConnectionState(state: "connected" | "reconnecting"): void {
    this.emitToSinks(workerForViewChannel("engine"), {
      type: "desktop-host/connection-state",
      payload: { state },
    });
  }

  private emitToSinks(channel: string, payload: unknown): void {
    for (const sink of this.sinks) sink.emit({ channel, payload });
  }

  private async dispatchHost(command: ViewCommand): Promise<unknown> {
    await this.ready;
    if (this.closed) throw remoteError("connection closed");
    const commandId = randomUUID();
    const envelope = GraftDesktopClientMessageSchema.parse({
      envelope: "command",
      commandId,
      requestId: commandId,
      command: {
        version: 1,
        type: command.type,
        ...("payload" in command
          ? { payload: asDesktopJson(command.payload) }
          : {}),
      },
    });
    if (envelope.envelope !== "command") {
      throw remoteError("command envelope could not be created");
    }
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(commandId, { envelope, command, resolve, reject });
      this.sendCommand(envelope);
    });
  }

  private async dispatchSplit(command: ViewCommand): Promise<unknown> {
    switch (command.type) {
      case "turn/start":
        return this.dispatchTurnWithUploads(command);
      case "files/import":
        return this.dispatchImportWithUploads(command);
      default:
        throw remoteError(`${command.type} has no remote hand-off adapter`);
    }
  }

  private async dispatchTurnWithUploads(
    command: Extract<ViewCommand, { type: "turn/start" }>,
  ): Promise<unknown> {
    if (!this.negotiatedCapabilities.has("runs")) {
      throw remoteError("the host did not grant runs");
    }
    const sourcePaths = [
      ...(command.payload.filePaths ?? []),
      ...(command.payload.imagePreviews ?? []).map((image) => image.path),
    ];
    if (sourcePaths.length === 0) return this.dispatchHost(command);
    if (!this.negotiatedCapabilities.has("bulk_transfer")) {
      throw remoteError("the host did not grant bulk_transfer");
    }
    const readApprovedRemoteFile =
      this.clientPlatform.readApprovedRemoteFile?.bind(this.clientPlatform);
    if (!readApprovedRemoteFile) {
      throw remoteError("local attachment access is unavailable");
    }
    const references = new Map<string, string>();
    for (const path of new Set(sourcePaths)) {
      const snapshot = await readApprovedRemoteFile({
        purpose: "attachment",
        path,
      });
      if (!snapshot) throw remoteError("a local attachment is not approved");
      const ticket = await this.uploadBulk(snapshot.data, snapshot.mediaType);
      references.set(
        path,
        uploadReference(ticket.transferId, snapshot.fileName),
      );
    }
    return this.dispatchHost({
      ...command,
      payload: {
        ...command.payload,
        ...(command.payload.filePaths
          ? {
              filePaths: command.payload.filePaths.map(
                (path) => references.get(path) ?? path,
              ),
            }
          : {}),
        ...(command.payload.imagePreviews
          ? {
              imagePreviews: command.payload.imagePreviews.map((image) => ({
                ...image,
                path: references.get(image.path) ?? image.path,
              })),
            }
          : {}),
      },
    });
  }

  private async dispatchImportWithUploads(
    command: Extract<ViewCommand, { type: "files/import" }>,
  ): Promise<unknown> {
    if (!this.negotiatedCapabilities.has("files")) {
      throw remoteError("the host did not grant files");
    }
    if (!this.negotiatedCapabilities.has("bulk_transfer")) {
      throw remoteError("the host did not grant bulk_transfer");
    }
    const readApprovedRemoteFile =
      this.clientPlatform.readApprovedRemoteFile?.bind(this.clientPlatform);
    if (!readApprovedRemoteFile) {
      throw remoteError("local import access is unavailable");
    }
    const sourcePaths: string[] = [];
    const approvalTokens: string[] = [];
    for (const [index, sourcePath] of command.payload.sourcePaths.entries()) {
      const snapshot = await readApprovedRemoteFile({
        purpose: "import",
        sourcePath,
        approvalToken: command.payload.approvalTokens[index] ?? "",
        projectId: command.payload.projectId,
        worktreeId: command.payload.worktreeId,
        targetDir: command.payload.targetDir,
      });
      if (!snapshot) throw remoteError("a local import is not approved");
      const ticket = await this.uploadBulk(snapshot.data, snapshot.mediaType);
      sourcePaths.push(uploadReference(ticket.transferId, snapshot.fileName));
      approvalTokens.push(ticket.transferId);
    }
    return this.dispatchHost({
      ...command,
      payload: { ...command.payload, sourcePaths, approvalTokens },
    });
  }

  private sendCommand(
    envelope: GraftDesktopClientMessage & { envelope: "command" },
  ): void {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(JSON.stringify(envelope));
    } catch {
      this.handleDisconnect(this.socketGeneration);
    }
  }

  private handleDisconnect(generation: number): void {
    if (generation !== this.socketGeneration || this.closed) return;
    this.connected = false;
    this.emitConnectionState("reconnecting");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const base = this.options.reconnectDelayMs ?? 250;
    const maximum = this.options.maxReconnectDelayMs ?? 5_000;
    const delay = Math.min(maximum, base * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private failProtocol(error: Error): void {
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    this.rejectOutstanding(error);
    this.options.onFatalError?.(error);
    void this.close();
  }

  private rejectOutstanding(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
