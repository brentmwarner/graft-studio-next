import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMobilePairingLink,
  getConnectionsStatus,
  listSshMachines,
  saveSshMachine,
} from "./graftConnections";

describe("graftConnections", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubDesktopBridge() {
    vi.stubGlobal("window", {
      desktopBridge: {
        getWsUrl: () => "ws://127.0.0.1:4111/ws?token=desktop-secret",
      },
      location: { origin: "http://localhost:8891" },
    });
  }

  it("creates pairing links against the desktop websocket origin", async () => {
    stubDesktopBridge();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        pairingUrl: "graft://pair?v=1&host=http%3A%2F%2F100.70.80.90%3A47831#token=abc",
        expiresAt: 1,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createMobilePairingLink();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4111/v1/pairing-link?token=desktop-secret",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(result.pairingUrl).toContain("graft://pair");
  });

  it("loads connections status against the desktop websocket origin", async () => {
    stubDesktopBridge();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        enabled: false,
        networkAccessEnabled: false,
        environmentId: "env",
        environmentLabel: "Studio",
        bindHost: "127.0.0.1",
        port: null,
        endpoints: [],
        devices: [],
        pairingUrl: null,
        pairingExpiresAt: null,
        relay: { state: "disabled", lastError: null },
        diagnostics: "enabled=false",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await getConnectionsStatus();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4111/api/graft/connections/status?token=desktop-secret",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(status.enabled).toBe(false);
  });

  it("saves SSH machines against the desktop websocket origin", async () => {
    stubDesktopBridge();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        machine: {
          id: "machine-1",
          label: "omarchy",
          sshTarget: "brent@omarchy",
          effectiveHostname: null,
          connected: false,
          environmentLabel: null,
          daemonVersion: null,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await saveSshMachine({ label: "omarchy", sshTarget: "brent@omarchy" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4111/api/graft/ssh/machines?token=desktop-secret",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ label: "omarchy", sshTarget: "brent@omarchy" }),
      }),
    );
  });

  it("rejects HTML SPA fallbacks instead of showing an empty SSH list", async () => {
    stubDesktopBridge();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Unexpected token <");
        },
      }),
    );

    await expect(listSshMachines()).rejects.toThrow(/Request failed with status 200/);
  });

  it("surfaces mobile gateway error messages", async () => {
    stubDesktopBridge();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          code: "authentication_required",
          message: "Authentication required.",
        }),
      }),
    );

    await expect(createMobilePairingLink()).rejects.toThrow("Authentication required.");
  });
});
