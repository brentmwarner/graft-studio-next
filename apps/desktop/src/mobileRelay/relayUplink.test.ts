import { describe, expect, it, vi } from "vitest";
import {
  createRelayUplink,
  type RelayUplinkOptions,
  type RelayUplinkStatus,
} from "./relayUplink.js";

/**
 * `never[]` accepts every listener shape the uplink registers; `emit` supplies
 * the real arguments.
 */
type Listener = (...args: never[]) => void;

class FakeSocket {
  readyState = 1;
  readonly sent: string[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  private readonly listeners = new Map<string, Listener[]>();

  send(data: unknown): void {
    this.sent.push(
      typeof data === "string" ? data : Buffer.from(data as Buffer).toString(),
    );
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
    this.readyState = 3;
  }

  terminate(): void {
    this.readyState = 3;
  }

  on(event: string, listener: Listener): this {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (...args: unknown[]) => void)(...args);
    }
  }

  frames(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }

  lastFrame(): Record<string, unknown> {
    const frames = this.frames();
    const last = frames[frames.length - 1];
    if (!last) throw new Error("no frame was sent");
    return last;
  }

  receive(frame: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(frame)));
  }
}

const CREDENTIAL = {
  uplinkUrl: "wss://relay.example.test/relay/v1/uplink",
  environmentId: "env-1",
  uplinkSecret: "0123456789abcdef0123456789abcdef",
  localHttpBaseUrl: "http://127.0.0.1:47831",
};

function setup(overrides: Partial<RelayUplinkOptions> = {}) {
  const sockets: FakeSocket[] = [];
  const statuses: RelayUplinkStatus[] = [];
  const uplink = createRelayUplink({
    ...CREDENTIAL,
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onStatusChange: (status) => statuses.push({ ...status }),
    ...overrides,
  });
  return { uplink, sockets, statuses };
}

function connect(context: ReturnType<typeof setup>): FakeSocket {
  context.uplink.start();
  const socket = context.sockets[0];
  if (!socket) throw new Error("uplink never dialed out");
  socket.emit("open");
  socket.receive({
    type: "registered",
    environmentId: CREDENTIAL.environmentId,
    httpBaseUrl: "https://relay.example.test/e/env-1",
    wsBaseUrl: "wss://relay.example.test/e/env-1",
  });
  return socket;
}

describe("createRelayUplink", () => {
  it("dials out and registers with the environment secret", () => {
    const context = setup();
    const socket = connect(context);

    expect(socket.frames()[0]).toEqual({
      type: "register",
      protocolVersion: 1,
      environmentId: "env-1",
      uplinkSecret: CREDENTIAL.uplinkSecret,
    });
    expect(context.uplink.getStatus()).toMatchObject({
      state: "connected",
      httpBaseUrl: "https://relay.example.test/e/env-1",
      wsBaseUrl: "wss://relay.example.test/e/env-1",
    });
  });

  it("proxies a relayed request to the local gateway verbatim", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const context = setup({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const socket = connect(context);

    socket.receive({
      type: "http",
      requestId: "req-1",
      method: "POST",
      path: "/v1/pair",
      headers: { authorization: "Bearer phone-token", host: "relay.example" },
      bodyBase64: Buffer.from(JSON.stringify({ token: "abc" })).toString(
        "base64",
      ),
    });
    await vi.waitFor(() => {
      expect(socket.lastFrame().type).toBe("http-response");
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    if (!init) throw new Error("the uplink never called the local gateway");
    expect(url).toBe("http://127.0.0.1:47831/v1/pair");
    expect(init.method).toBe("POST");
    // The phone's bearer is forwarded untouched; hop-by-hop headers are not.
    expect(init.headers).toMatchObject({ authorization: "Bearer phone-token" });
    expect(init.headers).not.toHaveProperty("host");

    const response = socket.lastFrame();
    expect(response).toMatchObject({ requestId: "req-1", status: 200 });
    expect(
      Buffer.from(response.bodyBase64 as string, "base64").toString(),
    ).toBe(JSON.stringify({ ok: true }));
  });

  it("answers host_offline when the local gateway is unreachable", async () => {
    const context = setup({
      fetchImpl: (() =>
        Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch,
    });
    const socket = connect(context);

    socket.receive({
      type: "http",
      requestId: "req-2",
      method: "GET",
      path: "/v1/health",
      headers: {},
    });
    await vi.waitFor(() => {
      expect(socket.lastFrame().status).toBe(502);
    });

    const body = JSON.parse(
      Buffer.from(socket.lastFrame().bodyBase64 as string, "base64").toString(),
    ) as { error: { code: string } };
    expect(body.error.code).toBe("host_offline");
  });

  it("tunnels a relayed WebSocket through the local gateway", () => {
    const opened: Array<{ url: string; headers: Record<string, string> }> = [];
    const localSockets: FakeSocket[] = [];
    const context = setup({
      createSocket: (url, init) => {
        const socket = new FakeSocket();
        if (url.startsWith("ws://127.0.0.1")) {
          opened.push({ url, headers: init?.headers ?? {} });
          localSockets.push(socket);
        } else {
          context.sockets.push(socket);
        }
        return socket;
      },
    });
    // The first socket is the uplink itself; later ones are local streams.
    context.uplink.start();
    const socket = context.sockets[0]!;
    socket.emit("open");
    socket.receive({
      type: "registered",
      environmentId: "env-1",
      httpBaseUrl: "https://relay.example.test/e/env-1",
      wsBaseUrl: "wss://relay.example.test/e/env-1",
    });

    socket.receive({
      type: "ws-open",
      streamId: "stream-1",
      path: "/v1/ws",
      headers: { authorization: "Bearer phone-token" },
    });
    const local = localSockets[0]!;
    expect(opened[0]).toEqual({
      url: "ws://127.0.0.1:47831/v1/ws",
      headers: { authorization: "Bearer phone-token" },
    });

    local.emit("open");
    expect(socket.lastFrame()).toEqual({
      type: "ws-opened",
      streamId: "stream-1",
    });

    local.emit("message", Buffer.from("from-desktop"), false);
    expect(socket.lastFrame()).toMatchObject({
      type: "ws-frame",
      streamId: "stream-1",
    });
    expect(
      Buffer.from(socket.lastFrame().dataBase64 as string, "base64").toString(),
    ).toBe("from-desktop");

    socket.receive({
      type: "ws-frame",
      streamId: "stream-1",
      dataBase64: Buffer.from("from-phone").toString("base64"),
    });
    expect(local.sent).toEqual(["from-phone"]);

    socket.receive({ type: "ws-close", streamId: "stream-1", code: 1000 });
    expect(local.closes).toHaveLength(1);
  });

  it("stops retrying when the relay rejects the secret", () => {
    const context = setup({ reconnectDelaysMs: [1] });
    const socket = connect(context);

    socket.receive({ type: "register-failed", reason: "unauthorized" });
    socket.emit("close");

    expect(context.uplink.getStatus()).toMatchObject({
      state: "error",
      rejected: true,
    });
    expect(context.sockets).toHaveLength(1);
  });
});
