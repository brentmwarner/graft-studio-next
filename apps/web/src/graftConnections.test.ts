import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMobilePairingLink,
  connectGraftRelay,
  getConnectionsStatus,
  listSshMachines,
  saveSshMachine,
} from "./graftConnections";

describe("graftConnections", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubDesktopBridge(account?: {
    getState: () => Promise<{ status: string }>;
    connectRelay: () => Promise<void>;
  }) {
    vi.stubGlobal("window", {
      desktopBridge: {
        getWsUrl: () => "ws://127.0.0.1:4111/ws?token=desktop-secret",
        account,
      },
      location: { origin: "http://localhost:8891" },
    });
  }

  it.each(["disabled", "error"])(
    "connects the signed-in desktop relay before issuing a pairing link when relay is %s",
    async (relayState) => {
      const events: string[] = [];
      const connectRelay = vi.fn(async () => {
        events.push("relay");
      });
      stubDesktopBridge({
        getState: async () => ({ status: "signed-in" }),
        connectRelay,
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const path = new URL(url).pathname;
          events.push(path);
          return {
            ok: true,
            json: async () =>
              path.endsWith("/status") || path.endsWith("/enabled")
                ? { enabled: false, relay: { state: relayState } }
                : {
                    pairingUrl: "graft://pair?host=https%3A%2F%2Frelay.example%2Fe%2Fhost",
                    expiresAt: 1,
                  },
          };
        }),
      );

      await createMobilePairingLink();

      expect(events).toEqual([
        "/api/graft/connections/status",
        "/api/graft/connections/enabled",
        "relay",
        "/v1/pairing-link",
      ]);
    },
  );

  it("does not issue a LAN pairing link after desktop relay registration fails", async () => {
    stubDesktopBridge({
      getState: async () => ({ status: "signed-in" }),
      connectRelay: async () => {
        throw new Error("Relay registration failed");
      },
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ enabled: true, relay: { state: "disabled" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createMobilePairingLink()).rejects.toThrow("Relay registration failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses the saved relay restored when connections are enabled again", async () => {
    const connectRelay = vi.fn();
    stubDesktopBridge({ getState: async () => ({ status: "signed-in" }), connectRelay });
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        new URL(url).pathname.endsWith("/status")
          ? { enabled: false, relay: { state: "disabled" } }
          : { enabled: true, relay: { state: "connecting" } },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await createMobilePairingLink();
    expect(connectRelay).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(["connected", "connecting"])(
    "reuses a %s relay without rotating its credential",
    async (state) => {
      const connectRelay = vi.fn();
      stubDesktopBridge({ getState: async () => ({ status: "signed-in" }), connectRelay });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ enabled: true, relay: { state } }),
        })),
      );
      await createMobilePairingLink();
      expect(connectRelay).not.toHaveBeenCalled();
    },
  );

  it("preserves local pairing for a development desktop without an account", async () => {
    const connectRelay = vi.fn();
    stubDesktopBridge({ getState: async () => ({ status: "signed-out" }), connectRelay });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ pairingUrl: "graft://pair" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    await createMobilePairingLink();
    expect(connectRelay).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("starts relay sign-in through the authenticated owner connection", async () => {
    stubDesktopBridge();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(connectGraftRelay()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4111/api/graft/connections/relay/connect?token=desktop-secret",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

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
