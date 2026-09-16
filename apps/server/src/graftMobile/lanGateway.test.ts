import http from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";

import {
  isMobileGatewayPath,
  mobileLanGatewayAdvertisesIpv6,
  shouldStartMobileLanGateway,
  startMobileLanGateway,
  stopMobileLanGateway,
} from "./lanGateway";

afterEach(async () => {
  await stopMobileLanGateway();
});

describe("mobile LAN gateway", () => {
  it("exposes only /v1 paths on the LAN bind", async () => {
    const main = http.createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ path: request.url }));
    });
    await new Promise<void>((resolve) => main.listen(0, "127.0.0.1", () => resolve()));
    try {
      const port = await startMobileLanGateway(main);
      const allowed = await fetch(`http://127.0.0.1:${port}/v1/health`);
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toEqual({ path: "/v1/health" });

      const pair = await fetch(`http://127.0.0.1:${port}/v1/pair`, { method: "POST" });
      expect(pair.status).toBe(200);

      const blocked = await fetch(`http://127.0.0.1:${port}/api/graft/ssh/machines`);
      expect(blocked.status).toBe(404);
      expect(await blocked.json()).toEqual({ error: "Not found" });

      const pairingLink = await fetch(`http://127.0.0.1:${port}/v1/pairing-link`, {
        method: "POST",
      });
      expect(pairingLink.status).toBe(404);
      expect(await pairingLink.json()).toEqual({ error: "Not found" });

      if (mobileLanGatewayAdvertisesIpv6()) {
        const viaIpv6 = await fetch(`http://[::1]:${port}/v1/health`);
        expect(viaIpv6.status).toBe(200);
        expect(await viaIpv6.json()).toEqual({ path: "/v1/health" });
      }
    } finally {
      await new Promise<void>((resolve) => main.close(() => resolve()));
    }
  });

  it("closes live mobile sockets when disabled instead of waiting indefinitely", async () => {
    const main = http.createServer();
    const requestReceived = once(main, "request");
    const port = await startMobileLanGateway(main);
    const socket = connect(port, "127.0.0.1");
    const errors: NodeJS.ErrnoException[] = [];
    socket.on("error", (error) => errors.push(error));
    await once(socket, "connect");
    socket.write("GET /v1/health HTTP/1.1\r\nHost: localhost\r\n\r\n");
    // A client-side connect can fire before the server registers the socket.
    // Receiving a forwarded request proves this is an accepted live connection.
    await requestReceived;
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    await stopMobileLanGateway();
    await closed;
    expect(socket.destroyed).toBe(true);
    // Destroying an active TCP connection may close cleanly or reset the peer.
    expect(errors.every((error) => error.code === "ECONNRESET")).toBe(true);
  });

  it("recognizes mobile gateway paths and excludes owner pairing issuance", () => {
    expect(isMobileGatewayPath("/v1")).toBe(true);
    expect(isMobileGatewayPath("/v1/pair")).toBe(true);
    expect(isMobileGatewayPath("/v1/ws")).toBe(true);
    expect(isMobileGatewayPath("/v1/pairing-link")).toBe(false);
    expect(isMobileGatewayPath("/api/graft/ssh/machines")).toBe(false);
    expect(isMobileGatewayPath("/v10")).toBe(false);
  });

  it("starts only for authenticated loopback servers without a public URL", () => {
    expect(
      shouldStartMobileLanGateway({
        host: "127.0.0.1",
        authToken: "desktop-secret",
      }),
    ).toBe(true);
    expect(shouldStartMobileLanGateway({ host: "127.0.0.1" })).toBe(false);
    expect(
      shouldStartMobileLanGateway({
        host: "127.0.0.1",
        authToken: "desktop-secret",
        publicUrl: new URL("https://graft.example.test/"),
      }),
    ).toBe(false);
    expect(
      shouldStartMobileLanGateway({
        host: "0.0.0.0",
        authToken: "desktop-secret",
      }),
    ).toBe(false);
  });
});
