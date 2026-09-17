import { describe, expect, it, vi } from "vitest";

import { disconnectGraftAccountConnections } from "./graftAccountConnections";

describe("account connection startup", () => {
  it("waits for the HTTP listener without waiting for full history-import readiness", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ httpListening: false, startupReady: false }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ httpListening: true, startupReady: false }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await disconnectGraftAccountConnections({
      baseUrl: "http://127.0.0.1:3773",
      ownerToken: "test-owner",
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://127.0.0.1:3773/health");
    expect(String(fetchImpl.mock.calls[2]![0])).toBe("http://127.0.0.1:3773/health");
    expect(fetchImpl.mock.calls[3]).toEqual([
      new URL("http://127.0.0.1:3773/api/graft/connections/account/disconnect?token=test-owner"),
      expect.objectContaining({ method: "POST", redirect: "error" }),
    ]);
  });

  it("does not report success when the owner route rejects disconnection", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ httpListening: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(
      disconnectGraftAccountConnections({
        baseUrl: "http://127.0.0.1:3773",
        ownerToken: "test-owner",
        fetchImpl,
      }),
    ).rejects.toThrow("Could not disconnect");
  });
});
