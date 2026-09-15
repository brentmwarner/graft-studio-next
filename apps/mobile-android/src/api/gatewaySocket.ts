import {
  DEFAULT_MOBILE_CAPABILITIES,
  GRAFT_MOBILE_PROTOCOL_VERSION,
  GraftMobileHostMessageSchema,
  assertNeverMobile,
  type GraftMobileCommand,
  type GraftMobileCommandResult,
  type GraftMobileHostMessage,
  type GraftRemoteError,
  type GraftSessionCredential,
} from "@graft/mobile-contract";
import * as Crypto from "expo-crypto";

const COMMAND_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 15_000;
const PING_INTERVAL_MS = 25_000;
const MAX_RECONNECT_DELAY_MS = 15_000;

export type GatewayConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

interface ReactNativeWebSocketOptions {
  readonly headers?: Readonly<Record<string, string>>;
}

interface ReactNativeWebSocketConstructor {
  new (
    url: string,
    protocols?: string | readonly string[] | null,
    options?: ReactNativeWebSocketOptions,
  ): WebSocket;
}

interface PendingCommand {
  readonly resolve: (result: GraftMobileCommandResult | undefined) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface ConnectionWaiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export interface GatewaySocketHandlers {
  readonly onMessage: (message: GraftMobileHostMessage) => void;
  readonly onStateChange: (state: GatewayConnectionState) => void;
}

export class GatewaySocketError extends Error {
  override readonly name = "GatewaySocketError";

  constructor(
    message: string,
    readonly code = "socket_error",
    readonly outcomeUnknown = true,
  ) {
    super(message);
  }
}

export function buildWebSocketUrl(session: GraftSessionCredential): string {
  const url = new URL(session.wsBaseUrl);
  const trimmedPath = url.pathname.replace(/\/+$/, "");
  url.pathname = trimmedPath.endsWith("/v1/ws")
    ? trimmedPath
    : `${trimmedPath}/v1/ws`.replace(/^\/\//, "/");
  url.searchParams.delete("token");
  url.searchParams.set("sessionId", session.sessionId);
  return url.toString();
}

function remoteError(error: GraftRemoteError): GatewaySocketError {
  return new GatewaySocketError(error.message, error.code, error.code === "internal");
}

export class GatewaySocket {
  private socket: WebSocket | null = null;
  private session: GraftSessionCredential | null = null;
  private desired = false;
  private state: GatewayConnectionState = "disconnected";
  private afterCursor: number | undefined;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private readonly pendingCommands = new Map<string, PendingCommand>();
  private readonly connectionWaiters = new Set<ConnectionWaiter>();

  constructor(private readonly handlers: GatewaySocketHandlers) {}

  connect(session: GraftSessionCredential, afterCursor?: number): void {
    const changedSession = this.session?.sessionId !== session.sessionId;
    this.session = session;
    this.afterCursor = afterCursor;
    this.desired = true;

    if (!changedSession && (this.state === "connecting" || this.state === "connected")) {
      return;
    }
    if (changedSession) this.closeSocket();
    this.open(false);
  }

  updateCursor(cursor: number): void {
    this.afterCursor = cursor;
  }

  async command(
    command: GraftMobileCommand,
    commandId = Crypto.randomUUID(),
  ): Promise<GraftMobileCommandResult | undefined> {
    await this.ensureConnected();
    if (this.pendingCommands.has(commandId)) {
      throw new GatewaySocketError("This message is already being sent.", "command_pending", true);
    }

    return await new Promise<GraftMobileCommandResult | undefined>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        reject(new GatewaySocketError("The Graft host did not respond in time.", "timeout", true));
      }, COMMAND_TIMEOUT_MS);

      this.pendingCommands.set(commandId, { resolve, reject, timeout });
      try {
        this.send({
          envelope: "command",
          commandId,
          command,
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pendingCommands.delete(commandId);
        reject(
          error instanceof Error ? error : new GatewaySocketError("Could not send the command."),
        );
      }
    });
  }

  disconnect(): void {
    this.desired = false;
    this.clearReconnectTimer();
    this.closeSocket();
    const error = new GatewaySocketError("Disconnected from Graft Studio.", "socket_error", true);
    this.rejectPending(error);
    this.rejectConnectionWaiters(error);
    this.setState("disconnected");
  }

  private async ensureConnected(): Promise<void> {
    if (this.state === "connected" && this.socket?.readyState === WebSocket.OPEN) {
      return;
    }
    if (!this.session) {
      throw new GatewaySocketError("Pair with Graft Studio before sending a message.");
    }
    if (!this.desired) {
      this.desired = true;
      this.open(false);
    } else if (!this.socket && !this.reconnectTimer) {
      this.open(this.reconnectAttempt > 0);
    }

    await new Promise<void>((resolve, reject) => {
      const waiter: ConnectionWaiter = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.connectionWaiters.delete(waiter);
          reject(new GatewaySocketError("Could not connect to Graft Studio in time.", "timeout"));
        }, CONNECT_TIMEOUT_MS),
      };
      this.connectionWaiters.add(waiter);
    });
  }

  private open(isReconnect: boolean): void {
    const session = this.session;
    if (!this.desired || !session || this.socket) return;

    this.clearReconnectTimer();
    this.setState(isReconnect ? "reconnecting" : "connecting");

    const WebSocketConstructor = WebSocket as unknown as ReactNativeWebSocketConstructor;
    const socket = new WebSocketConstructor(buildWebSocketUrl(session), null, {
      headers: { Authorization: `Bearer ${session.bearerToken}` },
    });
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.send({
        envelope: "hello",
        protocolVersion: GRAFT_MOBILE_PROTOCOL_VERSION,
        sessionId: session.sessionId,
        afterCursor: this.afterCursor,
        capabilities: [...DEFAULT_MOBILE_CAPABILITIES],
      });
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.receive(event.data);
    };

    // RN often fires `onerror` then `onclose`. Let `onclose` own the state
    // transition so we don't report `disconnected` while `this.state` is still
    // `connecting` / `reconnecting` — that desync left `ensureConnected()`
    // waiters hanging until the 15s timeout after unpair/background.
    socket.onerror = () => {};

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopPing();
      this.setState("disconnected");
      const error = new GatewaySocketError("The connection to Graft Studio closed.");
      this.rejectPending(error);
      this.rejectConnectionWaiters(error);
      if (this.desired) this.scheduleReconnect();
    };
  }

  private receive(raw: unknown): void {
    let json: unknown;
    try {
      json = JSON.parse(String(raw));
    } catch {
      return;
    }

    const parsed = GraftMobileHostMessageSchema.safeParse(json);
    if (!parsed.success) return;
    const message = parsed.data;

    switch (message.envelope) {
      case "welcome":
        this.reconnectAttempt = 0;
        this.afterCursor = Math.max(this.afterCursor ?? 0, message.cursor);
        this.setState("connected");
        this.resolveConnectionWaiters();
        this.startPing();
        break;
      case "response": {
        const pending = this.pendingCommands.get(message.commandId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingCommands.delete(message.commandId);
          if (message.receipt.status === "rejected") {
            pending.reject(
              new GatewaySocketError(
                message.receipt.message ?? "Graft Studio rejected the command.",
                message.receipt.errorCode ?? "command_rejected",
                message.receipt.errorCode === "internal",
              ),
            );
          } else {
            pending.resolve(message.result);
          }
        }
        break;
      }
      case "event":
        this.afterCursor = Math.max(this.afterCursor ?? 0, message.event.cursor);
        break;
      case "error":
        if (message.error.commandId) {
          const pending = this.pendingCommands.get(message.error.commandId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingCommands.delete(message.error.commandId);
            pending.reject(remoteError(message.error));
          }
        }
        break;
      case "pong":
      case "snapshot_required":
        break;
      default:
        assertNeverMobile(message);
    }

    this.handlers.onMessage(message);
  }

  private send(message: Parameters<typeof JSON.stringify>[0]): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new GatewaySocketError("Graft Studio is not connected.");
    }
    this.socket.send(JSON.stringify(message));
  }

  private scheduleReconnect(): void {
    if (!this.desired || this.reconnectTimer) return;
    const baseDelay = Math.min(MAX_RECONNECT_DELAY_MS, 1_000 * 2 ** this.reconnectAttempt);
    const delay = Math.round(baseDelay * (0.75 + Math.random() * 0.5));
    this.reconnectAttempt += 1;
    this.setState("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.open(true);
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      this.send({ envelope: "ping", at: Math.floor(Date.now() / 1_000) });
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.stopPing();
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "client_disconnect");
    }
  }

  private setState(next: GatewayConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    this.handlers.onStateChange(next);
  }

  private resolveConnectionWaiters(): void {
    for (const waiter of this.connectionWaiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve();
    }
    this.connectionWaiters.clear();
  }

  private rejectConnectionWaiters(error: Error): void {
    for (const waiter of this.connectionWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.connectionWaiters.clear();
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingCommands.clear();
  }
}
