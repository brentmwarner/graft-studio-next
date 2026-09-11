import type { NetworkInterfaceInfo } from "node:os";
import { parseGraftPairingUrl } from "@graft/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRemoteGateway } from "./createRemoteGateway.js";
import { createRemoteGatewayController } from "./remoteGatewayController.js";
import { createInMemoryRemoteGatewaySettingsStore } from "./remoteGatewaySettingsStore.js";
import type { RemoteSessionSecretStore } from "./remoteSessionSecretStore.js";
import type {
  RelayUplink,
  RelayUplinkOptions,
  RelayUplinkStatus,
} from "./relayUplink.js";

describe("createRemoteGatewayController", () => {
  let controller: ReturnType<typeof createRemoteGatewayController> | undefined;

  afterEach(async () => {
    if (controller) {
      await controller.stop();
      controller = undefined;
    }
  });

  it("starts on loopback, issues pairing, and revokes devices", async () => {
    controller = createRemoteGatewayController({
      environmentId: "env-ctrl",
      environmentLabel: "Controller Mac",
      getNetworkInterfaces: () => ({
        en0: [networkEntry("192.168.20.4")],
        tailscale0: [networkEntry("100.90.80.70")],
      }),
    });

    expect(controller.getStatus().enabled).toBe(false);

    const enabled = await controller.setEnabled(true);
    expect(enabled.enabled).toBe(true);
    expect(enabled.port).toBeTypeOf("number");
    expect(enabled.bindHost).toBe("0.0.0.0");
    expect(enabled.networkAccessEnabled).toBe(true);
    expect(enabled.endpoints.map((endpoint) => endpoint.kind)).toEqual([
      "tailnet",
      "lan",
      "loopback",
    ]);

    const pairing = await controller.issuePairing();
    expect(parseGraftPairingUrl(pairing.pairingUrl)).toEqual(
      expect.objectContaining({
        host: `http://100.90.80.70:${enabled.port}`,
        endpointKind: "tailnet",
      }),
    );
    expect(controller.getStatus().pairingUrl).toBe(pairing.pairingUrl);
    expect(controller.latestCursor()).toBe(0);
    controller.publishEvent({
      id: "event-1",
      kind: "assistant.message",
      threadId: "thread-1",
      createdAt: Date.now(),
      text: "Connected",
    });
    expect(controller.latestCursor()).toBe(1);

    const pairResponse = await fetch(
      `http://127.0.0.1:${enabled.port}/v1/pair`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: pairing.token,
          protocolVersion: 1,
          client: { platform: "ios", appVersion: "0.1.0" },
        }),
      },
    );
    expect(pairResponse.ok).toBe(true);
    const body = (await pairResponse.json()) as {
      session: { deviceId: string; httpBaseUrl: string; wsBaseUrl: string };
    };
    expect(body.session.httpBaseUrl).toBe(
      `http://100.90.80.70:${enabled.port}`,
    );
    expect(body.session.wsBaseUrl).toBe(`ws://100.90.80.70:${enabled.port}`);

    const withDevice = controller.getStatus();
    expect(
      withDevice.devices.some((d) => d.deviceId === body.session.deviceId),
    ).toBe(true);
    // Paired but no open WebSocket yet — the device reports as not connected.
    expect(
      withDevice.devices.find((d) => d.deviceId === body.session.deviceId)
        ?.connected,
    ).toBe(false);

    const revoked = controller.revokeDevice(body.session.deviceId);
    expect(revoked.devices).toHaveLength(0);

    const disabled = await controller.setEnabled(false);
    expect(disabled.enabled).toBe(false);
    expect(disabled.port).toBeNull();
  });

  it("persists the bound port and enabled intent, then restores both", async () => {
    const settingsStore = createInMemoryRemoteGatewaySettingsStore();
    controller = createRemoteGatewayController({ settingsStore });

    const enabled = await controller.setEnabled(true);
    const boundPort = enabled.port;
    expect(boundPort).toBeTypeOf("number");
    expect(settingsStore.load()).toMatchObject({
      enabled: true,
      preferredPort: boundPort,
    });

    await controller.stop();

    // A fresh controller (new app launch) restores the same port unprompted.
    controller = createRemoteGatewayController({ settingsStore });
    expect(controller.getStatus().enabled).toBe(false);
    await controller.restorePersistedState();
    const restored = controller.getStatus();
    expect(restored.enabled).toBe(true);
    expect(restored.port).toBe(boundPort);

    const disabled = await controller.setEnabled(false);
    expect(disabled.enabled).toBe(false);
    expect(settingsStore.load()).toMatchObject({
      enabled: false,
      preferredPort: boundPort,
    });
    await controller.restorePersistedState();
    expect(controller.getStatus().enabled).toBe(false);
  });

  it("falls back to an ephemeral port when the preferred port is taken", async () => {
    const settingsStore = createInMemoryRemoteGatewaySettingsStore();
    const blocker = createRemoteGatewayController({
      settingsStore: createInMemoryRemoteGatewaySettingsStore(),
    });
    try {
      const blockerStatus = await blocker.setEnabled(true);
      settingsStore.save({
        enabled: true,
        keepHostAwake: false,
        preferredPort: blockerStatus.port,
      });

      controller = createRemoteGatewayController({ settingsStore });
      await controller.restorePersistedState();
      const status = controller.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.port).toBeTypeOf("number");
      expect(status.port).not.toBe(blockerStatus.port);
      expect(settingsStore.load().preferredPort).toBe(status.port);
    } finally {
      await blocker.stop();
    }
  });

  it("returns to a disabled state when the gateway cannot bind", async () => {
    controller = createRemoteGatewayController({
      gatewayFactory: (config, handlers, options) =>
        createRemoteGateway(
          { ...config, host: "203.0.113.1" },
          handlers,
          options,
        ),
    });

    await expect(controller.setEnabled(true)).rejects.toThrow();
    expect(controller.getStatus()).toMatchObject({
      enabled: false,
      port: null,
      pairingUrl: null,
    });
  });

  it("pairs over the relay so the phone never needs this Mac's network", async () => {
    const secretStore = inMemorySecretStore();
    secretStore.set("relay-uplink", JSON.stringify(RELAY_CREDENTIAL));

    controller = createRemoteGatewayController({
      environmentId: "env-relay",
      environmentLabel: "Relay Mac",
      getNetworkInterfaces: () => ({ en0: [networkEntry("192.168.20.4")] }),
      relay: {
        registration: {
          controlPlaneBaseUrl: "https://api.example.test",
          getAccountToken: () => Promise.resolve("account-jwt"),
          secretStore,
          fetchImpl: () => Promise.reject(new Error("must not register")),
        },
        uplinkFactory: (options) => connectedUplink(options),
      },
    });

    const enabled = await controller.setEnabled(true);
    await vi.waitFor(() => {
      expect(controller?.getStatus().relay.state).toBe("connected");
    });

    const status = controller.getStatus();
    expect(status.endpoints[0]).toMatchObject({
      kind: "relay",
      httpBaseUrl: RELAY_CREDENTIAL.httpBaseUrl,
      wsBaseUrl: RELAY_CREDENTIAL.wsBaseUrl,
    });
    expect(status.relay).toEqual({ state: "connected", lastError: null });

    const pairing = await controller.issuePairing();
    expect(parseGraftPairingUrl(pairing.pairingUrl)).toEqual(
      expect.objectContaining({
        host: RELAY_CREDENTIAL.httpBaseUrl,
        endpointKind: "relay",
      }),
    );
    expect(pairing.pairingUrl).not.toContain(String(enabled.port));

    // The phone stores whatever the desktop issued, so a relay pairing hands
    // back relay session URLs.
    const pairResponse = await fetch(
      `http://127.0.0.1:${enabled.port}/v1/pair`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: pairing.token,
          protocolVersion: 1,
          client: { platform: "android", appVersion: "0.1.0" },
        }),
      },
    );
    const body = (await pairResponse.json()) as {
      session: { httpBaseUrl: string; wsBaseUrl: string };
    };
    expect(body.session.httpBaseUrl).toBe(RELAY_CREDENTIAL.httpBaseUrl);
    expect(body.session.wsBaseUrl).toBe(RELAY_CREDENTIAL.wsBaseUrl);
  });

  it("keeps LAN pairing working when the relay cannot be reached", async () => {
    controller = createRemoteGatewayController({
      environmentId: "env-signed-out",
      getNetworkInterfaces: () => ({ en0: [networkEntry("192.168.20.4")] }),
      relay: {
        registration: {
          controlPlaneBaseUrl: "https://api.example.test",
          getAccountToken: () => Promise.resolve(null),
          secretStore: inMemorySecretStore(),
        },
        uplinkFactory: () => {
          throw new Error("uplink must not start while signed out");
        },
      },
    });

    const enabled = await controller.setEnabled(true);
    await vi.waitFor(() => {
      expect(controller?.getStatus().relay.state).toBe("error");
    });

    const status = controller.getStatus();
    expect(status.relay.lastError).toContain("Sign in");
    expect(status.endpoints.map((endpoint) => endpoint.kind)).toEqual([
      "lan",
      "loopback",
    ]);

    const pairing = await controller.issuePairing();
    expect(parseGraftPairingUrl(pairing.pairingUrl)).toEqual(
      expect.objectContaining({
        host: `http://192.168.20.4:${enabled.port}`,
        endpointKind: "lan",
      }),
    );
    expect(controller.diagnosticsText()).toContain("relay=error");
  });

  it("waits for a connecting uplink before minting a LAN pairing QR", async () => {
    const secretStore = inMemorySecretStore();
    secretStore.set("relay-uplink", JSON.stringify(RELAY_CREDENTIAL));

    controller = createRemoteGatewayController({
      environmentId: "env-relay-wait",
      getNetworkInterfaces: () => ({ en0: [networkEntry("192.168.20.4")] }),
      relay: {
        registration: {
          controlPlaneBaseUrl: "https://api.example.test",
          getAccountToken: () => Promise.resolve("account-jwt"),
          secretStore,
          fetchImpl: () => Promise.reject(new Error("must not register")),
        },
        uplinkFactory: (options) => delayedUplink(options, 40),
      },
    });

    await controller.setEnabled(true);
    const pairing = await controller.issuePairing();
    expect(parseGraftPairingUrl(pairing.pairingUrl)).toEqual(
      expect.objectContaining({
        host: RELAY_CREDENTIAL.httpBaseUrl,
        endpointKind: "relay",
      }),
    );
  });

  it("stops the relay and falls back to LAN after sign-out", async () => {
    const secretStore = inMemorySecretStore();
    secretStore.set("relay-uplink", JSON.stringify(RELAY_CREDENTIAL));
    let accountToken: string | null = "account-jwt";

    controller = createRemoteGatewayController({
      environmentId: "env-relay-logout",
      getNetworkInterfaces: () => ({ en0: [networkEntry("192.168.20.4")] }),
      relay: {
        registration: {
          controlPlaneBaseUrl: "https://api.example.test",
          getAccountToken: () => Promise.resolve(accountToken),
          secretStore,
          fetchImpl: () => Promise.reject(new Error("must not register")),
        },
        uplinkFactory: (options) => connectedUplink(options),
      },
    });

    const enabled = await controller.setEnabled(true);
    await vi.waitFor(() => {
      expect(controller?.getStatus().relay.state).toBe("connected");
    });

    accountToken = null;
    await controller.onAccountSignedOut();
    expect(secretStore.get("relay-uplink")).toBeNull();
    expect(controller.getStatus().relay.state).toBe("disabled");

    const pairing = await controller.issuePairing();
    expect(parseGraftPairingUrl(pairing.pairingUrl)).toEqual(
      expect.objectContaining({
        host: `http://192.168.20.4:${enabled.port}`,
        endpointKind: "lan",
      }),
    );
  });

  it("does not finish an in-flight relay start after sign-out", async () => {
    const secretStore = inMemorySecretStore();
    let accountToken: string | null = "account-jwt";
    const fetchImpl = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return new Response(JSON.stringify(RELAY_CREDENTIAL), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    controller = createRemoteGatewayController({
      environmentId: "env-relay-race",
      getNetworkInterfaces: () => ({ en0: [networkEntry("192.168.20.4")] }),
      relay: {
        registration: {
          controlPlaneBaseUrl: "https://api.example.test",
          getAccountToken: () => Promise.resolve(accountToken),
          secretStore,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
        uplinkFactory: (options) => connectedUplink(options),
      },
    });

    const enabling = controller.setEnabled(true);
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalled();
    });
    accountToken = null;
    await controller.onAccountSignedOut();
    await enabling;

    expect(secretStore.get("relay-uplink")).toBeNull();
    expect(controller.getStatus().relay.state).not.toBe("connected");
  });
});

const RELAY_CREDENTIAL = {
  environmentId: "env-relay-1",
  uplinkSecret: "0123456789abcdef0123456789abcdef",
  httpBaseUrl: "https://relay.example.test/e/env-relay-1",
  wsBaseUrl: "wss://relay.example.test/e/env-relay-1",
  uplinkUrl: "wss://relay.example.test/relay/v1/uplink",
};

function inMemorySecretStore(): RemoteSessionSecretStore {
  const secrets = new Map<string, string>();
  return {
    get: (key) => secrets.get(key) ?? null,
    set: (key, secret) => {
      secrets.set(key, secret);
    },
    delete: (key) => {
      secrets.delete(key);
    },
  };
}

/** Stands in for a relay that accepted the uplink immediately. */
function connectedUplink(options: RelayUplinkOptions): RelayUplink {
  let status: RelayUplinkStatus = {
    state: "disabled",
    environmentId: null,
    httpBaseUrl: null,
    wsBaseUrl: null,
    lastError: null,
    rejected: false,
  };
  return {
    start() {
      status = {
        state: "connected",
        environmentId: options.environmentId,
        httpBaseUrl: RELAY_CREDENTIAL.httpBaseUrl,
        wsBaseUrl: RELAY_CREDENTIAL.wsBaseUrl,
        lastError: null,
        rejected: false,
      };
      options.onStatusChange?.(status);
    },
    stop() {
      status = { ...status, state: "disabled" };
      options.onStatusChange?.(status);
    },
    getStatus: () => status,
  };
}

function delayedUplink(
  options: RelayUplinkOptions,
  delayMs: number,
): RelayUplink {
  let status: RelayUplinkStatus = {
    state: "disabled",
    environmentId: null,
    httpBaseUrl: null,
    wsBaseUrl: null,
    lastError: null,
    rejected: false,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    start() {
      status = {
        state: "connecting",
        environmentId: options.environmentId,
        httpBaseUrl: null,
        wsBaseUrl: null,
        lastError: null,
        rejected: false,
      };
      options.onStatusChange?.(status);
      timer = setTimeout(() => {
        status = {
          state: "connected",
          environmentId: options.environmentId,
          httpBaseUrl: RELAY_CREDENTIAL.httpBaseUrl,
          wsBaseUrl: RELAY_CREDENTIAL.wsBaseUrl,
          lastError: null,
          rejected: false,
        };
        options.onStatusChange?.(status);
      }, delayMs);
    },
    stop() {
      if (timer) clearTimeout(timer);
      status = { ...status, state: "disabled" };
      options.onStatusChange?.(status);
    },
    getStatus: () => status,
  };
}

function networkEntry(address: string): NetworkInterfaceInfo {
  return {
    address,
    family: "IPv4",
    internal: false,
    mac: "00:00:00:00:00:00",
    netmask: "255.255.255.0",
    cidr: null,
  };
}
