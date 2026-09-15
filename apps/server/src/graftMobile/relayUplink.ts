import { WebSocket, type RawData } from "ws";
import {
  GRAFT_RELAY_PROTOCOL_VERSION,
  parseRelayDownlinkFrame,
  type GraftRelayDownlinkFrame,
  type GraftRelayEnvironmentRegistration,
  type GraftRelayUplinkFrame,
} from "@graft/mobile-contract/relay";

import { isMobileGatewayPath } from "./lanGateway";

export type RelayStatus = {
  state: "disabled" | "connecting" | "connected" | "error";
  lastError: string | null;
};

const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const MAX_STREAMS = 64;
const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
]);

export function relayForwardHeaders(headers: Record<string, string>): Record<string, string> {
  const connectionHeaders = new Set(
    Object.entries(headers)
      .filter(([name]) => name.toLowerCase() === "connection")
      .flatMap(([, value]) =>
        value
          .toLowerCase()
          .split(",")
          .map((name) => name.trim()),
      ),
  );
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => {
      const lower = name.toLowerCase();
      return (
        !HOP_HEADERS.has(lower) &&
        !connectionHeaders.has(lower) &&
        !lower.startsWith("sec-websocket-") &&
        !lower.startsWith("x-forwarded-") &&
        lower !== "forwarded"
      );
    }),
  );
}

/** A relay cannot reach owner APIs, absolute URLs, or traversal outside mobile routes. */
export function relayLocalUrl(base: string, path: string, websocket = false): string | null {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  const url = new URL(path, base);
  if (
    url.origin !== new URL(base).origin ||
    url.pathname.includes("%") ||
    url.pathname.includes("//") ||
    !isMobileGatewayPath(url.pathname.replace(/\/+$/, ""))
  )
    return null;
  if (websocket && url.pathname !== "/v1/ws") return null;
  if (websocket) url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function createRelayUplink(options: {
  credential: GraftRelayEnvironmentRegistration;
  localHttpBaseUrl: string;
  onStatus: (status: RelayStatus) => void;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
}) {
  let stopped = true;
  let terminal = false;
  let socket: WebSocket | null = null;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setTimeout> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;
  const streams = new Map<string, WebSocket>();
  const requests = new Set<AbortController>();
  const publish = (state: RelayStatus["state"], lastError: string | null = null) =>
    options.onStatus({ state, lastError });

  function clearConnection() {
    clearTimeout(handshakeTimer);
    clearTimeout(pingTimer);
    clearTimeout(pongTimer);
    for (const request of requests) request.abort();
    requests.clear();
    for (const local of streams.values()) local.terminate();
    streams.clear();
  }

  function send(peer: WebSocket, frame: GraftRelayUplinkFrame) {
    if (stopped || socket !== peer || peer.readyState !== WebSocket.OPEN) return;
    if (peer.bufferedAmount > MAX_BUFFER_BYTES) {
      peer.terminate();
      return;
    }
    peer.send(JSON.stringify(frame));
  }

  function schedulePing(peer: WebSocket) {
    clearTimeout(pingTimer);
    pingTimer = setTimeout(() => {
      if (stopped || socket !== peer || peer.readyState !== WebSocket.OPEN) return;
      pongTimer = setTimeout(
        () => peer.terminate(),
        options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS,
      );
      pongTimer.unref();
      peer.ping();
    }, options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);
    pingTimer.unref();
  }

  async function proxyHttp(
    peer: WebSocket,
    frame: Extract<GraftRelayDownlinkFrame, { type: "http" }>,
  ) {
    const url = relayLocalUrl(options.localHttpBaseUrl, frame.path);
    const reply = (status: number, body: string) =>
      send(peer, {
        type: "http-response",
        requestId: frame.requestId,
        status,
        headers: { "content-type": "application/json" },
        bodyBase64: Buffer.from(body).toString("base64"),
      });
    if (!url) {
      reply(404, '{"error":"Not found"}');
      return;
    }
    if (requests.size >= MAX_STREAMS) {
      reply(503, '{"error":"Host busy"}');
      return;
    }
    let decodedBody: Buffer | undefined;
    if (frame.bodyBase64 && !["GET", "HEAD"].includes(frame.method)) {
      decodedBody = Buffer.from(frame.bodyBase64, "base64");
      if (decodedBody.byteLength > MAX_BUFFER_BYTES) {
        reply(413, '{"error":"Payload too large"}');
        return;
      }
    }
    const controller = new AbortController();
    requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timeout.unref();
    try {
      const response = await fetch(url, {
        method: frame.method,
        headers: relayForwardHeaders(frame.headers),
        ...(decodedBody && !["GET", "HEAD"].includes(frame.method) ? { body: decodedBody } : {}),
        signal: controller.signal,
        redirect: "manual",
      });
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      if (response.body) {
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          if (bytes > MAX_BUFFER_BYTES) throw new Error("Response too large");
          chunks.push(chunk);
        }
      }
      send(peer, {
        type: "http-response",
        requestId: frame.requestId,
        status: response.status,
        // Node fetch decompresses response bodies. Do not forward the encoding header.
        headers: relayForwardHeaders(
          Object.fromEntries([...response.headers].filter(([name]) => name !== "content-encoding")),
        ),
        bodyBase64: Buffer.concat(chunks).toString("base64"),
      });
    } catch {
      reply(
        502,
        '{"ok":false,"error":{"code":"host_offline","message":"The Graft host did not answer.","retryable":true}}',
      );
    } finally {
      clearTimeout(timeout);
      requests.delete(controller);
    }
  }

  function openStream(
    peer: WebSocket,
    frame: Extract<GraftRelayDownlinkFrame, { type: "ws-open" }>,
  ) {
    const url = relayLocalUrl(options.localHttpBaseUrl, frame.path, true);
    if (!url || streams.has(frame.streamId) || streams.size >= MAX_STREAMS) {
      send(peer, { type: "ws-open-failed", streamId: frame.streamId, reason: "stream_refused" });
      return;
    }
    const local = new WebSocket(url, {
      headers: relayForwardHeaders(frame.headers),
      handshakeTimeout: HEARTBEAT_TIMEOUT_MS,
      maxPayload: MAX_BUFFER_BYTES,
    });
    streams.set(frame.streamId, local);
    let opened = false;
    local.on("open", () => {
      opened = true;
      send(peer, { type: "ws-opened", streamId: frame.streamId });
    });
    local.on("message", (data: RawData, binary) => {
      send(peer, {
        type: "ws-frame",
        streamId: frame.streamId,
        dataBase64: rawBuffer(data).toString("base64"),
        binary,
      });
    });
    local.on("error", () => {}); // close owns failure/release, including failed handshakes.
    local.on("close", (code) => {
      if (streams.get(frame.streamId) !== local) return;
      streams.delete(frame.streamId);
      send(
        peer,
        opened
          ? { type: "ws-close", streamId: frame.streamId, code: validCloseCode(code) }
          : {
              type: "ws-open-failed",
              streamId: frame.streamId,
              reason: "local_gateway_unreachable",
            },
      );
    });
  }

  function receive(peer: WebSocket, data: RawData) {
    if (stopped || peer !== socket) return;
    let frame: GraftRelayDownlinkFrame | null;
    try {
      frame = parseRelayDownlinkFrame(JSON.parse(rawBuffer(data).toString("utf8")));
    } catch {
      return;
    }
    if (!frame) return;
    switch (frame.type) {
      case "registered":
        if (
          frame.environmentId !== options.credential.environmentId ||
          frame.httpBaseUrl !== options.credential.httpBaseUrl ||
          frame.wsBaseUrl !== options.credential.wsBaseUrl
        ) {
          terminal = true;
          publish(
            "error",
            "The relay returned a different environment. Reconnect your Graft account.",
          );
          peer.terminate();
          return;
        }
        clearTimeout(handshakeTimer);
        attempt = 0;
        publish("connected");
        schedulePing(peer);
        return;
      case "register-failed":
        terminal = true;
        publish(
          "error",
          `The Graft relay rejected this host (${frame.reason}). Reconnect your Graft account.`,
        );
        peer.terminate();
        return;
      case "http":
        void proxyHttp(peer, frame);
        return;
      case "ws-open":
        openStream(peer, frame);
        return;
      case "ws-frame": {
        const local = streams.get(frame.streamId);
        if (local?.readyState === WebSocket.OPEN) {
          const payload = Buffer.from(frame.dataBase64, "base64");
          if (local.bufferedAmount > MAX_BUFFER_BYTES || payload.byteLength > MAX_BUFFER_BYTES) {
            local.terminate();
          } else local.send(payload, { binary: frame.binary === true });
        }
        return;
      }
      case "ws-close":
        streams.get(frame.streamId)?.close(validCloseCode(frame.code));
        return;
      default: {
        const exhaustive: never = frame;
        return exhaustive;
      }
    }
  }

  function connect() {
    if (stopped || terminal) return;
    publish("connecting");
    const peer = new WebSocket(options.credential.uplinkUrl, {
      handshakeTimeout: HEARTBEAT_TIMEOUT_MS,
      maxPayload: MAX_BUFFER_BYTES * 2,
    });
    socket = peer;
    handshakeTimer = setTimeout(() => peer.terminate(), HEARTBEAT_TIMEOUT_MS);
    handshakeTimer.unref();
    peer.on("open", () =>
      send(peer, {
        type: "register",
        protocolVersion: GRAFT_RELAY_PROTOCOL_VERSION,
        environmentId: options.credential.environmentId,
        uplinkSecret: options.credential.uplinkSecret,
      }),
    );
    peer.on("message", (data) => receive(peer, data));
    peer.on("pong", () => {
      if (socket !== peer || stopped) return;
      clearTimeout(pongTimer);
      schedulePing(peer);
    });
    peer.on("error", () => {});
    peer.on("close", () => {
      if (socket !== peer) return;
      socket = null;
      clearConnection();
      if (stopped || terminal) return;
      publish("connecting", "Connection interrupted. Reconnecting to the Graft relay.");
      const delay = Math.min(500 * 2 ** Math.min(attempt++, 6), 15_000);
      retryTimer = setTimeout(connect, delay);
      retryTimer.unref();
    });
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      terminal = false;
      attempt = 0;
      connect();
    },
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      const peer = socket;
      socket = null;
      clearConnection();
      peer?.terminate();
      publish("disabled");
    },
  };
}

function rawBuffer(data: RawData): Buffer {
  return Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
}

function validCloseCode(code?: number): number {
  return code !== undefined &&
    ((code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) ||
      (code >= 3000 && code <= 4999))
    ? code
    : 1000;
}
