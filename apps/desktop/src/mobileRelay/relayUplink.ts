import {
  GRAFT_RELAY_PROTOCOL_VERSION,
  parseRelayDownlinkFrame,
  type GraftRelayUplinkFrame,
} from "@graft/mobile-contract/relay";
import { toWebSocketBaseUrl } from "@graft/mobile-contract";
import { WebSocket } from "ws";

/**
 * Outbound relay uplink.
 *
 * The desktop dials *out* to the managed relay so phones never need LAN or
 * Tailnet reachability. Everything arriving on this socket is proxied to the
 * gateway already listening on loopback — this is a byte pipe, not a second
 * implementation of the mobile protocol. Handlers are deliberately not called
 * directly so relayed traffic goes through the exact same HTTP and WebSocket
 * paths as a LAN phone.
 */

export type RelayUplinkState =
  | "disabled"
  | "connecting"
  | "connected"
  | "error";

export type RelayUplinkStatus = {
  state: RelayUplinkState;
  environmentId: string | null;
  httpBaseUrl: string | null;
  wsBaseUrl: string | null;
  lastError: string | null;
  /**
   * The relay refused this secret. Retrying with the same credential cannot
   * succeed, so the owner re-registers instead of reconnecting.
   */
  rejected: boolean;
};

/**
 * The slice of a WebSocket the uplink actually drives. Structural rather than
 * `Pick<WebSocket, …>` so tests can stand in a fake without reproducing ws's
 * full overload table.
 */
type SocketLike = {
  readonly readyState: number;
  send(data: string | Buffer, options?: { binary?: boolean }): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: "open", listener: () => void): unknown;
  on(
    event: "message",
    listener: (data: unknown, isBinary: boolean) => void,
  ): unknown;
  on(event: "close", listener: (code: number, reason: Buffer) => void): unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
};

export type RelayUplinkOptions = {
  uplinkUrl: string;
  environmentId: string;
  uplinkSecret: string;
  /** Loopback base of the already-running local gateway. */
  localHttpBaseUrl: string;
  onStatusChange?: (status: RelayUplinkStatus) => void;
  /** Test seams. */
  createSocket?: (
    url: string,
    init?: { headers: Record<string, string> },
  ) => SocketLike;
  fetchImpl?: typeof fetch;
  reconnectDelaysMs?: readonly number[];
  setTimeoutImpl?: typeof setTimeout;
};

export type RelayUplink = {
  start: () => void;
  stop: () => void;
  getStatus: () => RelayUplinkStatus;
};

const DEFAULT_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 15_000, 30_000];
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

export function createRelayUplink(options: RelayUplinkOptions): RelayUplink {
  const reconnectDelays =
    options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
  const createSocket =
    options.createSocket ??
    ((url: string, init?: { headers: Record<string, string> }) =>
      new WebSocket(url, init) as SocketLike);
  const fetchImpl = options.fetchImpl ?? fetch;
  const scheduleTimeout = options.setTimeoutImpl ?? setTimeout;
  const localWsBaseUrl = toWebSocketBaseUrl(options.localHttpBaseUrl);

  let socket: SocketLike | null = null;
  let stopped = true;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const localStreams = new Map<string, SocketLike>();

  let status: RelayUplinkStatus = {
    state: "disabled",
    environmentId: null,
    httpBaseUrl: null,
    wsBaseUrl: null,
    lastError: null,
    rejected: false,
  };

  function setStatus(next: Partial<RelayUplinkStatus>): void {
    status = { ...status, ...next };
    options.onStatusChange?.(status);
  }

  function send(frame: GraftRelayUplinkFrame): void {
    if (!socket || socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify(frame));
    } catch {
      // The socket is closing; its close handler drives the reconnect.
    }
  }

  function closeLocalStreams(): void {
    for (const local of localStreams.values()) {
      try {
        local.close();
      } catch {
        // Already gone.
      }
    }
    localStreams.clear();
  }

  async function proxyHttp(frame: {
    requestId: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    bodyBase64?: string;
  }): Promise<void> {
    try {
      const response = await fetchImpl(`${options.localHttpBaseUrl}${frame.path}`, {
        method: frame.method,
        headers: forwardableHeaders(frame.headers),
        ...(frame.bodyBase64 !== undefined && frame.method !== "GET" &&
        frame.method !== "HEAD"
          ? { body: Buffer.from(frame.bodyBase64, "base64") }
          : {}),
      });
      const body = Buffer.from(await response.arrayBuffer());
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) return;
        headers[name] = value;
      });
      send({
        type: "http-response",
        requestId: frame.requestId,
        status: response.status,
        headers,
        ...(body.byteLength > 0
          ? { bodyBase64: body.toString("base64") }
          : {}),
      });
    } catch {
      send({
        type: "http-response",
        requestId: frame.requestId,
        status: 502,
        headers: { "content-type": "application/json" },
        bodyBase64: Buffer.from(
          JSON.stringify({
            ok: false,
            error: {
              code: "host_offline",
              message: "The local Graft gateway did not answer.",
            },
          }),
        ).toString("base64"),
      });
    }
  }

  function openLocalStream(frame: {
    streamId: string;
    path: string;
    headers: Record<string, string>;
  }): void {
    let local: SocketLike;
    try {
      local = createSocket(`${localWsBaseUrl}${frame.path}`, {
        headers: forwardableHeaders(frame.headers),
      });
    } catch (error) {
      send({
        type: "ws-open-failed",
        streamId: frame.streamId,
        reason: describeError(error).slice(0, 256),
      });
      return;
    }

    let opened = false;
    localStreams.set(frame.streamId, local);

    local.on("open", () => {
      opened = true;
      send({ type: "ws-opened", streamId: frame.streamId });
    });
    local.on("message", (data: unknown, isBinary: boolean) => {
      send({
        type: "ws-frame",
        streamId: frame.streamId,
        dataBase64: toBuffer(data).toString("base64"),
        ...(isBinary ? { binary: true } : {}),
      });
    });
    local.on("close", (code: number, reason: Buffer) => {
      localStreams.delete(frame.streamId);
      if (!opened) {
        send({
          type: "ws-open-failed",
          streamId: frame.streamId,
          reason: `local_gateway_closed_${code}`,
        });
        return;
      }
      send({
        type: "ws-close",
        streamId: frame.streamId,
        code: normalizeCloseCode(code),
        reason: reason?.toString("utf8").slice(0, 123) || undefined,
      });
    });
    local.on("error", () => {
      if (opened) return;
      localStreams.delete(frame.streamId);
      send({
        type: "ws-open-failed",
        streamId: frame.streamId,
        reason: "local_gateway_unreachable",
      });
    });
  }

  function handleDownlink(raw: string): void {
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
    const frame = parseRelayDownlinkFrame(decoded);
    if (!frame) return;

    switch (frame.type) {
      case "registered":
        attempt = 0;
        setStatus({
          state: "connected",
          environmentId: frame.environmentId,
          httpBaseUrl: frame.httpBaseUrl,
          wsBaseUrl: frame.wsBaseUrl,
          lastError: null,
          rejected: false,
        });
        return;

      case "register-failed":
        setStatus({
          state: "error",
          lastError: `Relay rejected this host (${frame.reason}).`,
          rejected: true,
        });
        // An unauthorized or revoked environment will not fix itself by
        // retrying with the same secret.
        stopped = true;
        socket?.close();
        return;

      case "http":
        void proxyHttp(frame);
        return;

      case "ws-open":
        openLocalStream(frame);
        return;

      case "ws-frame": {
        const local = localStreams.get(frame.streamId);
        if (!local || local.readyState !== 1) return;
        local.send(Buffer.from(frame.dataBase64, "base64"), {
          binary: frame.binary === true,
        });
        return;
      }

      case "ws-close": {
        const local = localStreams.get(frame.streamId);
        localStreams.delete(frame.streamId);
        try {
          local?.close(normalizeCloseCode(frame.code), frame.reason);
        } catch {
          // Already closed.
        }
        return;
      }

      default: {
        const exhaustive: never = frame;
        return exhaustive;
      }
    }
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    const delay =
      reconnectDelays[Math.min(attempt, reconnectDelays.length - 1)] ??
      DEFAULT_RECONNECT_DELAYS_MS[DEFAULT_RECONNECT_DELAYS_MS.length - 1]!;
    attempt += 1;
    reconnectTimer = scheduleTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
    reconnectTimer.unref?.();
  }

  function connect(): void {
    if (stopped) return;
    setStatus({ state: "connecting", rejected: false });

    let candidate: SocketLike;
    try {
      candidate = createSocket(options.uplinkUrl);
    } catch (error) {
      setStatus({ state: "error", lastError: describeError(error) });
      scheduleReconnect();
      return;
    }
    socket = candidate;

    candidate.on("open", () => {
      send({
        type: "register",
        protocolVersion: GRAFT_RELAY_PROTOCOL_VERSION,
        environmentId: options.environmentId,
        uplinkSecret: options.uplinkSecret,
      });
    });
    candidate.on("message", (data: unknown) => {
      handleDownlink(toBuffer(data).toString("utf8"));
    });
    candidate.on("error", (error: unknown) => {
      setStatus({ state: "error", lastError: describeError(error) });
    });
    candidate.on("close", () => {
      if (socket === candidate) socket = null;
      closeLocalStreams();
      if (stopped) {
        // A rejection is the reason this socket closed, so keep it visible
        // instead of reporting a clean shutdown.
        setStatus({
          state: status.rejected ? "error" : "disabled",
          httpBaseUrl: null,
          wsBaseUrl: null,
        });
        return;
      }
      setStatus({ state: "connecting", httpBaseUrl: null, wsBaseUrl: null });
      scheduleReconnect();
    });
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      attempt = 0;
      connect();
    },

    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      closeLocalStreams();
      const active = socket;
      socket = null;
      try {
        active?.close();
      } catch {
        // Already closed.
      }
      setStatus({
        state: "disabled",
        httpBaseUrl: null,
        wsBaseUrl: null,
        lastError: null,
        rejected: false,
      });
    },

    getStatus() {
      return status;
    },
  };
}

function forwardableHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower.startsWith("sec-websocket-")) continue;
    forwarded[lower] = value;
  }
  return forwarded;
}

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(String(data));
}

/** 1005/1006 are receive-only codes and illegal to send back out. */
function normalizeCloseCode(code: number | undefined): number {
  if (code === undefined) return 1000;
  if (code < 1000 || code > 4999 || code === 1005 || code === 1006) return 1000;
  return code;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
