import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { isMobileGatewayPath, startMobileLanGateway, stopMobileLanGateway } from "./lanGateway";

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

      const blocked = await fetch(`http://127.0.0.1:${port}/api/graft/ssh/machines`);
      expect(blocked.status).toBe(404);
      expect(await blocked.json()).toEqual({ error: "Not found" });
    } finally {
      await new Promise<void>((resolve) => main.close(() => resolve()));
    }
  });

  it("recognizes mobile gateway paths", () => {
    expect(isMobileGatewayPath("/v1")).toBe(true);
    expect(isMobileGatewayPath("/v1/pair")).toBe(true);
    expect(isMobileGatewayPath("/v1/ws")).toBe(true);
    expect(isMobileGatewayPath("/api/graft/ssh/machines")).toBe(false);
    expect(isMobileGatewayPath("/v10")).toBe(false);
  });
});
