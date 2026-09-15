import http from "node:http";
import { once } from "node:events";

import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import type { GraftRelayUplinkFrame } from "@graft/mobile-contract/relay";

import {
  createRelayUplink,
  relayForwardHeaders,
  relayLocalUrl,
  type RelayStatus,
} from "./relayUplink";

const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});

async function fixture(options: { autoPong?: boolean } = {}) {
  const received: Array<{ path: string; authorization: string | undefined }> = [];
  const hellos: unknown[] = [];
  const local = http.createServer((request, response) => {
    received.push({ path: request.url!, authorization: request.headers.authorization });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, source: "authenticated-host" }));
  });
  const localWs = new WebSocketServer({ server: local });
  localWs.on("connection", (peer, request) => {
    received.push({ path: request.url!, authorization: request.headers.authorization });
    peer.on("message", (data) => {
      hellos.push(JSON.parse(data.toString()));
      peer.send(JSON.stringify({ envelope: "welcome", cursor: 42 }));
    });
  });
  local.listen(0, "127.0.0.1");
  await once(local, "listening");
  const address = local.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  cleanups.push(async () => {
    for (const peer of localWs.clients) peer.terminate();
    local.closeAllConnections();
    await new Promise<void>((resolve) => local.close(() => resolve()));
    localWs.close();
  });
  const relay = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    autoPong: options.autoPong ?? true,
  });
  await once(relay, "listening");
  const relayAddress = relay.address();
  if (!relayAddress || typeof relayAddress === "string") throw new Error("Missing relay port");
  const credential = {
    environmentId: "mobile-test",
    uplinkSecret: "test-uplink-secret-1234",
    httpBaseUrl: "https://relay.example/e/mobile-test",
    wsBaseUrl: "wss://relay.example/e/mobile-test",
    uplinkUrl: `ws://127.0.0.1:${relayAddress.port}/relay/v1/uplink`,
  };
  const peers: WebSocket[] = [];
  const frames: GraftRelayUplinkFrame[] = [];
  relay.on("connection", (peer) => {
    peers.push(peer);
    peer.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as GraftRelayUplinkFrame;
      frames.push(frame);
      if (frame.type === "register")
        peer.send(
          JSON.stringify({
            type: "registered",
            environmentId: credential.environmentId,
            httpBaseUrl: credential.httpBaseUrl,
            wsBaseUrl: credential.wsBaseUrl,
          }),
        );
    });
  });
  cleanups.push(async () => {
    for (const peer of relay.clients) peer.terminate();
    await new Promise<void>((resolve) => relay.close(() => resolve()));
  });
  const states: RelayStatus[] = [];
  const uplink = createRelayUplink({
    credential,
    localHttpBaseUrl: `http://127.0.0.1:${address.port}`,
    onStatus: (state) => states.push(state),
    ...(options.autoPong === false ? { heartbeatIntervalMs: 20, heartbeatTimeoutMs: 30 } : {}),
  });
  cleanups.push(() => uplink.stop());
  uplink.start();
  await expect.poll(() => states.at(-1)?.state).toBe("connected");
  return { peers, frames, received, hellos, states, uplink };
}

describe("mobile relay", () => {
  it("forwards authenticated HTTP and mobile frames over the outbound relay", async () => {
    const test = await fixture();
    test.peers[0]!.send(
      JSON.stringify({
        type: "http",
        requestId: "pair",
        method: "POST",
        path: "/v1/pair",
        headers: {
          authorization: "Bearer mobile-session",
          "content-type": "application/json",
        },
        bodyBase64: Buffer.from('{"token":"one-time"}').toString("base64"),
      }),
    );
    await expect
      .poll(() => test.frames.find((frame) => frame.type === "http-response"))
      .toMatchObject({ status: 200 });
    test.peers[0]!.send(
      JSON.stringify({
        type: "ws-open",
        streamId: "phone",
        path: "/v1/ws?sessionId=session",
        headers: {
          authorization: "Bearer mobile-session",
        },
      }),
    );
    await expect.poll(() => test.frames.some((frame) => frame.type === "ws-opened")).toBe(true);
    test.peers[0]!.send(
      JSON.stringify({
        type: "ws-frame",
        streamId: "phone",
        dataBase64: Buffer.from(
          JSON.stringify({
            envelope: "hello",
            afterCursor: 17,
          }),
        ).toString("base64"),
      }),
    );
    await expect.poll(() => test.hellos).toEqual([{ envelope: "hello", afterCursor: 17 }]);
    await expect
      .poll(() =>
        test.frames.some(
          (frame) =>
            frame.type === "ws-frame" &&
            JSON.parse(Buffer.from(frame.dataBase64, "base64").toString()).envelope === "welcome",
        ),
      )
      .toBe(true);
    expect(test.received).toEqual([
      { path: "/v1/pair", authorization: "Bearer mobile-session" },
      { path: "/v1/ws?sessionId=session", authorization: "Bearer mobile-session" },
    ]);
  });

  it("forwards authenticated attachment upload and cancellation under mobile routes", async () => {
    const test = await fixture();
    for (const action of ["upload", "cancel"]) {
      const path = `/v1/attachments/${action}`;
      test.peers[0]!.send(
        JSON.stringify({
          type: "http",
          requestId: action,
          method: "POST",
          path,
          headers: {
            authorization: "Bearer mobile-session",
            "content-type": "application/octet-stream",
          },
          bodyBase64: Buffer.from("attachment payload").toString("base64"),
        }),
      );
      await expect
        .poll(() =>
          test.frames.find((frame) => frame.type === "http-response" && frame.requestId === action),
        )
        .toMatchObject({ status: 200 });
      expect(test.received).toContainEqual({ path, authorization: "Bearer mobile-session" });
      expect(relayLocalUrl("http://127.0.0.1:5000", path, true)).toBeNull();
    }
  });

  it("reconnects after an uplink drop and forwards a resumed phone session", async () => {
    const test = await fixture();
    test.peers[0]!.terminate();
    await expect.poll(() => test.peers.length).toBe(2);
    await expect.poll(() => test.states.at(-1)?.state).toBe("connected");
    test.peers[1]!.send(
      JSON.stringify({
        type: "ws-open",
        streamId: "resumed",
        path: "/v1/ws",
        headers: { authorization: "Bearer same-session" },
      }),
    );
    await expect
      .poll(() =>
        test.frames.some((frame) => frame.type === "ws-opened" && frame.streamId === "resumed"),
      )
      .toBe(true);
    test.peers[1]!.send(
      JSON.stringify({
        type: "ws-frame",
        streamId: "resumed",
        dataBase64: Buffer.from('{"envelope":"hello","afterCursor":42}').toString("base64"),
      }),
    );
    await expect.poll(() => test.hellos).toContainEqual({ envelope: "hello", afterCursor: 42 });
  });

  it("replaces a silently stalled uplink when pong never arrives", async () => {
    const test = await fixture({ autoPong: false });
    await expect.poll(() => test.peers.length, { timeout: 3_000 }).toBeGreaterThanOrEqual(2);
    expect(test.states.some((state) => state.lastError?.includes("interrupted"))).toBe(true);
  });

  it("stops all reconnect attempts after explicit shutdown", async () => {
    const test = await fixture();
    test.uplink.stop();
    test.peers[0]!.terminate();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(test.peers).toHaveLength(1);
    expect(test.states.at(-1)?.state).toBe("disabled");
  });

  it("keeps the relay out of owner APIs and other origins", () => {
    const base = "http://127.0.0.1:5000";
    for (const path of [
      "/api/graft/connections/enabled",
      "/v1/pairing-link",
      "/v1/%70airing-link",
      "/v1/pairing-link/",
      "/v1//pairing-link",
      "/v1/../api/auth",
      "//evil.example/v1/pair",
      "https://evil.example/v1/health",
      "/v1/%2e%2e/api/auth",
      "/v1\\..\\api/auth",
    ]) {
      expect(relayLocalUrl(base, path)).toBeNull();
    }
    expect(relayLocalUrl(base, "/v1/snapshot?threadId=one")).toBe(
      `${base}/v1/snapshot?threadId=one`,
    );
    expect(relayLocalUrl(base, "/v1/pair", true)).toBeNull();
    expect(relayLocalUrl(base, "/v1/ws", true)).toBe("ws://127.0.0.1:5000/v1/ws");
  });

  it("preserves bearer auth while stripping proxy, socket and connection-nominated headers", () => {
    expect(
      relayForwardHeaders({
        Authorization: "Bearer session",
        Connection: "X-Internal",
        "X-Internal": "secret",
        "X-Forwarded-Host": "evil",
        Forwarded: "host=evil",
        Host: "relay",
        "Sec-WebSocket-Key": "key",
      }),
    ).toEqual({ Authorization: "Bearer session" });
  });
});
