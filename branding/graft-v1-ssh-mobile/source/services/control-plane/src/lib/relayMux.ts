import { randomUUID } from "node:crypto";
import {
  GRAFT_RELAY_PROTOCOL_VERSION,
  parseRelayUplinkFrame,
  type GraftRelayDownlinkFrame,
} from "@graft/shared";

/**
 * In-memory multiplexer between phone traffic and one desktop uplink socket
 * per environment.
 *
 * The relay is transport only. Frames are forwarded and dropped; nothing here
 * writes request or response payloads to disk, to logs, or to the database.
 * Buffers live only for the lifetime of an in-flight request or open stream.
 */

const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_OPEN_TIMEOUT_MS = 15_000;
/** Snapshots are the largest legitimate payload on this path. */
export const RELAY_MAX_BODY_BYTES = 8 * 1024 * 1024;

export interface RelayUplinkSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RelayHttpRequest {
  method: string;
  /** Path plus query relative to the environment prefix, e.g. `/v1/health`. */
  path: string;
  headers: Record<string, string>;
  body?: Buffer;
}

export interface RelayHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export interface RelayStreamListener {
  onFrame(data: Buffer, binary: boolean): void;
  onClose(code: number | undefined, reason: string | undefined): void;
}

export interface RelayStream {
  send(data: Buffer, binary: boolean): void;
  close(code?: number, reason?: string): void;
}

export interface RelayUplinkHandle {
  environmentId: string;
  /** Feed one raw uplink message. Malformed frames are ignored. */
  handleMessage(raw: string): void;
  /** Uplink went away: fail everything routed through it. */
  detach(): void;
}

export class RelayHostOfflineError extends Error {
  readonly code = "host_offline";

  constructor(message = "The Graft host is not connected to the relay.") {
    super(message);
    this.name = "RelayHostOfflineError";
  }
}

export interface RelayMuxOptions {
  httpTimeoutMs?: number;
  openTimeoutMs?: number;
  maxBodyBytes?: number;
  onEnvironmentOnline?: (environmentId: string) => void;
}

export interface RelayMux {
  attachUplink(input: {
    environmentId: string;
    socket: RelayUplinkSocket;
    httpBaseUrl: string;
    wsBaseUrl: string;
  }): RelayUplinkHandle;
  hasUplink(environmentId: string): boolean;
  onlineEnvironmentCount(): number;
  request(
    environmentId: string,
    request: RelayHttpRequest,
  ): Promise<RelayHttpResponse>;
  openStream(
    environmentId: string,
    input: { path: string; headers: Record<string, string> },
    listener: RelayStreamListener,
  ): Promise<RelayStream>;
  closeAll(): void;
}

type PendingRequest = {
  environmentId: string;
  resolve: (response: RelayHttpResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type StreamState = {
  environmentId: string;
  listener: RelayStreamListener;
  opened: boolean;
  closed: boolean;
  openTimer?: NodeJS.Timeout;
  resolveOpen?: (stream: RelayStream) => void;
  rejectOpen?: (error: Error) => void;
};

type UplinkState = {
  environmentId: string;
  socket: RelayUplinkSocket;
  detached: boolean;
};

export function createRelayMux(options: RelayMuxOptions = {}): RelayMux {
  const httpTimeoutMs = options.httpTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const openTimeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? RELAY_MAX_BODY_BYTES;

  const uplinks = new Map<string, UplinkState>();
  const pendingRequests = new Map<string, PendingRequest>();
  const streams = new Map<string, StreamState>();

  function sendDownlink(
    uplink: UplinkState,
    frame: GraftRelayDownlinkFrame,
  ): void {
    try {
      uplink.socket.send(JSON.stringify(frame));
    } catch {
      // A dead socket surfaces through its own close handler, which fails
      // every exchange routed through this environment.
    }
  }

  function requireUplink(environmentId: string): UplinkState {
    const uplink = uplinks.get(environmentId);
    if (!uplink || uplink.detached) {
      throw new RelayHostOfflineError();
    }
    return uplink;
  }

  function failEnvironment(environmentId: string): void {
    for (const [requestId, pending] of pendingRequests) {
      if (pending.environmentId !== environmentId) continue;
      clearTimeout(pending.timer);
      pendingRequests.delete(requestId);
      pending.reject(new RelayHostOfflineError());
    }
    for (const [streamId, stream] of streams) {
      if (stream.environmentId !== environmentId) continue;
      streams.delete(streamId);
      if (stream.openTimer) clearTimeout(stream.openTimer);
      if (!stream.opened) {
        stream.rejectOpen?.(new RelayHostOfflineError());
        continue;
      }
      if (!stream.closed) {
        stream.closed = true;
        stream.listener.onClose(1012, "host_offline");
      }
    }
  }

  function streamHandle(streamId: string, environmentId: string): RelayStream {
    return {
      send(data, binary) {
        const stream = streams.get(streamId);
        if (!stream || stream.closed) return;
        let uplink: UplinkState;
        try {
          uplink = requireUplink(environmentId);
        } catch {
          return;
        }
        sendDownlink(uplink, {
          type: "ws-frame",
          streamId,
          dataBase64: data.toString("base64"),
          ...(binary ? { binary: true } : {}),
        });
      },
      close(code, reason) {
        const stream = streams.get(streamId);
        if (!stream) return;
        streams.delete(streamId);
        if (stream.openTimer) clearTimeout(stream.openTimer);
        stream.closed = true;
        const uplink = uplinks.get(environmentId);
        if (uplink && !uplink.detached) {
          sendDownlink(uplink, {
            type: "ws-close",
            streamId,
            ...(code !== undefined ? { code } : {}),
            ...(reason !== undefined ? { reason } : {}),
          });
        }
      },
    };
  }

  function handleUplinkMessage(environmentId: string, raw: string): void {
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
    const frame = parseRelayUplinkFrame(decoded);
    if (!frame) return;

    switch (frame.type) {
      case "register":
        // Registration is settled during the WS handshake; a second register
        // frame on a live uplink is meaningless.
        return;

      case "http-response": {
        const pending = pendingRequests.get(frame.requestId);
        if (!pending || pending.environmentId !== environmentId) return;
        pendingRequests.delete(frame.requestId);
        clearTimeout(pending.timer);
        const body = frame.bodyBase64
          ? Buffer.from(frame.bodyBase64, "base64")
          : Buffer.alloc(0);
        if (body.byteLength > maxBodyBytes) {
          pending.reject(new Error("relay_response_too_large"));
          return;
        }
        pending.resolve({
          status: frame.status,
          headers: frame.headers,
          body,
        });
        return;
      }

      case "ws-opened": {
        const stream = streams.get(frame.streamId);
        if (!stream || stream.environmentId !== environmentId) return;
        if (stream.openTimer) clearTimeout(stream.openTimer);
        if (stream.opened) return;
        stream.opened = true;
        stream.resolveOpen?.(streamHandle(frame.streamId, environmentId));
        return;
      }

      case "ws-open-failed": {
        const stream = streams.get(frame.streamId);
        if (!stream || stream.environmentId !== environmentId) return;
        streams.delete(frame.streamId);
        if (stream.openTimer) clearTimeout(stream.openTimer);
        stream.rejectOpen?.(new Error(frame.reason ?? "ws_open_failed"));
        return;
      }

      case "ws-frame": {
        const stream = streams.get(frame.streamId);
        if (!stream || stream.environmentId !== environmentId) return;
        if (!stream.opened || stream.closed) return;
        stream.listener.onFrame(
          Buffer.from(frame.dataBase64, "base64"),
          frame.binary === true,
        );
        return;
      }

      case "ws-close": {
        const stream = streams.get(frame.streamId);
        if (!stream || stream.environmentId !== environmentId) return;
        streams.delete(frame.streamId);
        if (stream.openTimer) clearTimeout(stream.openTimer);
        if (!stream.opened) {
          stream.rejectOpen?.(new Error("ws_closed_before_open"));
          return;
        }
        if (stream.closed) return;
        stream.closed = true;
        stream.listener.onClose(frame.code, frame.reason);
        return;
      }

      default: {
        const exhaustive: never = frame;
        return exhaustive;
      }
    }
  }

  return {
    attachUplink({ environmentId, socket, httpBaseUrl, wsBaseUrl }) {
      // A reconnecting desktop replaces its predecessor rather than racing it.
      const previous = uplinks.get(environmentId);
      if (previous && !previous.detached) {
        previous.detached = true;
        failEnvironment(environmentId);
        try {
          previous.socket.close(1000, "replaced_by_new_uplink");
        } catch {
          // The stale socket is already gone.
        }
      }

      const uplink: UplinkState = { environmentId, socket, detached: false };
      uplinks.set(environmentId, uplink);
      sendDownlink(uplink, {
        type: "registered",
        environmentId,
        httpBaseUrl,
        wsBaseUrl,
      });
      options.onEnvironmentOnline?.(environmentId);

      return {
        environmentId,
        handleMessage(raw) {
          if (uplink.detached) return;
          handleUplinkMessage(environmentId, raw);
        },
        detach() {
          if (uplink.detached) return;
          uplink.detached = true;
          if (uplinks.get(environmentId) === uplink) {
            uplinks.delete(environmentId);
          }
          failEnvironment(environmentId);
        },
      };
    },

    hasUplink(environmentId) {
      const uplink = uplinks.get(environmentId);
      return uplink !== undefined && !uplink.detached;
    },

    onlineEnvironmentCount() {
      return uplinks.size;
    },

    async request(environmentId, request) {
      const uplink = requireUplink(environmentId);
      if (request.body && request.body.byteLength > maxBodyBytes) {
        throw new Error("relay_request_too_large");
      }
      const requestId = randomUUID();

      return new Promise<RelayHttpResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(requestId);
          reject(new Error("relay_request_timeout"));
        }, httpTimeoutMs);
        timer.unref?.();
        pendingRequests.set(requestId, {
          environmentId,
          resolve,
          reject,
          timer,
        });

        sendDownlink(uplink, {
          type: "http",
          requestId,
          method: request.method,
          path: request.path,
          headers: request.headers,
          ...(request.body && request.body.byteLength > 0
            ? { bodyBase64: request.body.toString("base64") }
            : {}),
        });
      });
    },

    async openStream(environmentId, input, listener) {
      const uplink = requireUplink(environmentId);
      const streamId = randomUUID();

      return new Promise<RelayStream>((resolve, reject) => {
        const openTimer = setTimeout(() => {
          streams.delete(streamId);
          reject(new Error("relay_stream_open_timeout"));
        }, openTimeoutMs);
        openTimer.unref?.();

        streams.set(streamId, {
          environmentId,
          listener,
          opened: false,
          closed: false,
          openTimer,
          resolveOpen: resolve,
          rejectOpen: reject,
        });

        sendDownlink(uplink, {
          type: "ws-open",
          streamId,
          path: input.path,
          headers: input.headers,
        });
      });
    },

    closeAll() {
      for (const [environmentId, uplink] of uplinks) {
        uplink.detached = true;
        uplinks.delete(environmentId);
        failEnvironment(environmentId);
        try {
          uplink.socket.close(1001, "relay_shutdown");
        } catch {
          // Shutdown is best effort.
        }
      }
    },
  };
}

export { GRAFT_RELAY_PROTOCOL_VERSION };
