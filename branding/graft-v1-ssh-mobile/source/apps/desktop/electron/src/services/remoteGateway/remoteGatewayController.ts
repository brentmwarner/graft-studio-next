import { hostname, networkInterfaces } from "node:os";
import { powerSaveBlocker } from "electron";
import type { GraftTimelineEvent } from "@graft/shared";
import {
  createRemoteGateway,
  type RemoteGateway,
} from "./createRemoteGateway.js";
import {
  discoverNetworkEndpoints,
  preferredPairingEndpoint,
  relayNetworkEndpoint,
  sortEndpointsByPreference,
  type DiscoveredNetworkEndpoint,
  type NetworkInterfaceMap,
} from "./networkEndpoints.js";
import {
  createRelayUplink,
  type RelayUplink,
  type RelayUplinkStatus,
} from "./relayUplink.js";
import {
  RelaySignedOutError,
  clearStoredRelayCredential,
  ensureRelayCredential,
  readStoredRelayCredential,
  registerRelayEnvironment,
  type RelayRegistrationDependencies,
} from "./relayRegistration.js";
import {
  createPairingService,
  type PairingService,
  type PairingServiceDependencies,
} from "./pairingService.js";
import type { RemoteGatewaySettingsStore } from "./remoteGatewaySettingsStore.js";
import {
  createStubRemoteGatewayHandlers,
  type RemoteGatewayHandlers,
} from "./types.js";

export type RemoteGatewayDevice = {
  deviceId: string;
  sessionId: string;
  label: string;
  platform: "ios" | "android" | "web" | "desktop";
  appVersion: string;
  environmentLabel: string;
  lastSeenAt: number;
  connected: boolean;
};

const RELAY_PAIRING_WAIT_MS = 8_000;

function describeRelayError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export type RemoteGatewayRelayState =
  | "disabled"
  | "connecting"
  | "connected"
  | "error";

export type RemoteGatewayRelayStatus = {
  state: RemoteGatewayRelayState;
  lastError: string | null;
};

export type RemoteGatewayStatus = {
  enabled: boolean;
  networkAccessEnabled: boolean;
  keepHostAwake: boolean;
  environmentId: string;
  environmentLabel: string;
  bindHost: string;
  port: number | null;
  endpoints: DiscoveredNetworkEndpoint[];
  devices: RemoteGatewayDevice[];
  pairingUrl: string | null;
  pairingExpiresAt: number | null;
  relay: RemoteGatewayRelayStatus;
};

export type RemoteGatewayController = {
  getStatus: () => RemoteGatewayStatus;
  setEnabled: (enabled: boolean) => Promise<RemoteGatewayStatus>;
  setKeepHostAwake: (enabled: boolean) => RemoteGatewayStatus;
  restorePersistedState: () => Promise<void>;
  setHandlers: (next: RemoteGatewayHandlers) => void;
  publishEvent: (
    event: Omit<GraftTimelineEvent, "cursor">,
  ) => GraftTimelineEvent | null;
  latestCursor: () => number;
  issuePairing: () => Promise<{
    pairingUrl: string;
    expiresAt: number;
    token: string;
  }>;
  revokeDevice: (deviceId: string) => RemoteGatewayStatus;
  diagnosticsText: () => string;
  /**
   * Drop the stored uplink secret and disconnect. Pairing then falls back to
   * LAN/Tailnet until the owner signs in again.
   */
  onAccountSignedOut: () => Promise<void>;
  stop: () => Promise<void>;
};

export function createRemoteGatewayController(input?: {
  handlers?: RemoteGatewayHandlers;
  environmentId?: string;
  environmentLabel?: string;
  pairingDependencies?: PairingServiceDependencies;
  getNetworkInterfaces?: () => NetworkInterfaceMap;
  pushRegistrationEnabled?: boolean;
  gatewayFactory?: typeof createRemoteGateway;
  settingsStore?: RemoteGatewaySettingsStore;
  /**
   * Managed relay. Omitted in tests and when the desktop has no encrypted
   * credential store, in which case pairing falls back to LAN/Tailnet.
   */
  relay?: {
    registration: RelayRegistrationDependencies;
    uplinkFactory?: typeof createRelayUplink;
  };
}): RemoteGatewayController {
  const environmentId = input?.environmentId ?? "local-studio";
  const environmentLabel = input?.environmentLabel ?? hostname();
  let handlers = input?.handlers ?? createStubRemoteGatewayHandlers();
  // Live proxy so setHandlers() takes effect for an already-running gateway
  // without a hand-maintained 16-method forwarder.
  const liveHandlers: RemoteGatewayHandlers = new Proxy({} as RemoteGatewayHandlers, {
    get(_target, property, receiver) {
      const value = Reflect.get(handlers, property, receiver);
      return typeof value === "function" ? value.bind(handlers) : value;
    },
  });
  const getNetworkInterfaces = input?.getNetworkInterfaces ?? networkInterfaces;
  const gatewayFactory = input?.gatewayFactory ?? createRemoteGateway;

  const settingsStore = input?.settingsStore;
  const persistedSettings = settingsStore?.load();
  let enabled = false;
  let keepHostAwake = persistedSettings?.keepHostAwake ?? false;
  let gateway: RemoteGateway | undefined;
  let wakeBlockerId: number | undefined;
  let lastPairingUrl: string | null = null;
  let lastPairingExpiresAt: number | null = null;

  const relayConfig = input?.relay;
  const relayUplinkFactory = relayConfig?.uplinkFactory ?? createRelayUplink;
  let relayUplink: RelayUplink | undefined;
  let relayPending: Promise<void> | undefined;
  let relayEpoch = 0;
  let relayStatus: RelayUplinkStatus = {
    state: "disabled",
    environmentId: null,
    httpBaseUrl: null,
    wsBaseUrl: null,
    lastError: null,
    rejected: false,
  };

  function relayEndpoint(): DiscoveredNetworkEndpoint | null {
    if (relayStatus.state !== "connected") return null;
    if (!relayStatus.httpBaseUrl || !relayStatus.wsBaseUrl) return null;
    return relayNetworkEndpoint({
      httpBaseUrl: relayStatus.httpBaseUrl,
      wsBaseUrl: relayStatus.wsBaseUrl,
    });
  }

  async function startRelay(port: number, rekey = false): Promise<void> {
    if (!relayConfig) return;
    const epoch = relayEpoch;
    await stopRelay();
    if (epoch !== relayEpoch) return;
    relayStatus = {
      state: "connecting",
      environmentId: null,
      httpBaseUrl: null,
      wsBaseUrl: null,
      lastError: null,
      rejected: false,
    };
    try {
      const stored = readStoredRelayCredential(
        relayConfig.registration.secretStore,
      );
      const credential =
        rekey && stored
          ? // Re-registering under the same environment id rotates the secret
            // without changing the relay URL paired phones already hold.
            await registerRelayEnvironment(relayConfig.registration, {
              environmentId: stored.environmentId,
            })
          : await ensureRelayCredential(relayConfig.registration);
      if (epoch !== relayEpoch) return;
      const uplink = relayUplinkFactory({
        uplinkUrl: credential.uplinkUrl,
        environmentId: credential.environmentId,
        uplinkSecret: credential.uplinkSecret,
        localHttpBaseUrl: `http://127.0.0.1:${port}`,
        onStatusChange: (next) => {
          if (epoch !== relayEpoch) return;
          relayStatus = next;
          if (next.state === "error" && next.rejected === true && !rekey) {
            relayPending = startRelay(port, true);
          }
        },
      });
      if (epoch !== relayEpoch) return;
      relayUplink = uplink;
      uplink.start();
    } catch (error) {
      if (epoch !== relayEpoch) return;
      // Registration failures are not fatal: pairing falls back to LAN or
      // Tailnet and the reason shows up in diagnostics.
      relayStatus = {
        state: "error",
        environmentId: null,
        httpBaseUrl: null,
        wsBaseUrl: null,
        rejected: false,
        lastError:
          error instanceof RelaySignedOutError
            ? error.message
            : describeRelayError(error),
      };
    }
  }

  async function stopRelay(): Promise<void> {
    relayUplink?.stop();
    relayUplink = undefined;
    relayStatus = {
      state: "disabled",
      environmentId: null,
      httpBaseUrl: null,
      wsBaseUrl: null,
      lastError: null,
      rejected: false,
    };
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async function waitForRelayBeforePairing(): Promise<void> {
    if (!relayConfig) return;
    const pending = relayPending;
    if (pending) {
      await Promise.race([pending, sleep(RELAY_PAIRING_WAIT_MS)]);
    }
    if (
      relayStatus.state === "connected" ||
      relayStatus.state === "error" ||
      relayStatus.state === "disabled"
    ) {
      return;
    }
    const deadline = Date.now() + RELAY_PAIRING_WAIT_MS;
    while (relayStatus.state === "connecting" && Date.now() < deadline) {
      await sleep(50);
    }
  }

  function persistSettings() {
    settingsStore?.save({
      enabled,
      keepHostAwake,
      preferredPort: gateway?.config.port ?? settingsStore.load().preferredPort,
    });
  }
  const offlinePairing: PairingService | undefined = input?.pairingDependencies
    ? createPairingService(
        {
          host: "127.0.0.1",
          port: 0,
          environmentId,
          environmentLabel,
          networkAccessEnabled: false,
          pushRegistrationEnabled: input.pushRegistrationEnabled === true,
        },
        input.pairingDependencies,
      )
    : undefined;

  function status(): RemoteGatewayStatus {
    const devices = (gateway?.pairing ?? offlinePairing)?.listDevices() ?? [];
    const connectedDeviceIds =
      gateway?.sessions.activeDeviceIds() ?? new Set<string>();
    const port = gateway?.config.port ?? null;
    const bindHost = gateway?.config.host ?? "127.0.0.1";
    const relay = relayEndpoint();
    const endpoints =
      port == null
        ? []
        : sortEndpointsByPreference([
            ...(relay ? [relay] : []),
            ...discoverNetworkEndpoints(port, getNetworkInterfaces()),
          ]);

    return {
      enabled,
      networkAccessEnabled: gateway?.config.networkAccessEnabled ?? false,
      keepHostAwake,
      environmentId,
      environmentLabel,
      bindHost,
      port,
      endpoints,
      devices: devices.map((device) => ({
        deviceId: device.deviceId,
        sessionId: device.sessionId,
        label: device.label,
        platform: device.platform,
        appVersion: device.appVersion,
        environmentLabel,
        lastSeenAt: device.lastSeenAt,
        connected: connectedDeviceIds.has(device.deviceId),
      })),
      pairingUrl: lastPairingUrl,
      pairingExpiresAt: lastPairingExpiresAt,
      relay: {
        state: relayStatus.state,
        lastError: relayStatus.lastError,
      },
    };
  }

  function syncWakeBlocker() {
    const shouldBlock = enabled && keepHostAwake;
    try {
      if (shouldBlock && wakeBlockerId === undefined) {
        wakeBlockerId = powerSaveBlocker.start("prevent-app-suspension");
        return;
      }
      if (!shouldBlock && wakeBlockerId !== undefined) {
        if (powerSaveBlocker.isStarted(wakeBlockerId)) {
          powerSaveBlocker.stop(wakeBlockerId);
        }
        wakeBlockerId = undefined;
      }
    } catch {
      // powerSaveBlocker requires a running Electron app; ignore in unit tests.
      wakeBlockerId = undefined;
    }
  }

  async function stopGateway() {
    await relayPending;
    relayPending = undefined;
    await stopRelay();
    if (!gateway) return;
    await gateway.stop();
    gateway = undefined;
    lastPairingUrl = null;
    lastPairingExpiresAt = null;
  }

  const controller: RemoteGatewayController = {
    getStatus: status,

    setHandlers(next) {
      handlers = next;
    },

    publishEvent(event) {
      if (!gateway) return null;
      const appended = gateway.journal.append(event);
      gateway.sessions.broadcastEvent(appended);
      return appended;
    },

    latestCursor() {
      return gateway?.journal.latestCursor() ?? 0;
    },

    async setEnabled(nextEnabled) {
      if (nextEnabled === enabled && (nextEnabled ? gateway : !gateway)) {
        return status();
      }
      if (!nextEnabled) {
        await stopGateway();
        enabled = false;
        syncWakeBlocker();
        persistSettings();
        return status();
      }

      await stopGateway();
      const startGateway = async (port: number) => {
        // This toggle is the explicit authorization for network-wide binding.
        const candidate = gatewayFactory(
          {
            host: "0.0.0.0",
            port,
            environmentId,
            environmentLabel,
            networkAccessEnabled: true,
            pushRegistrationEnabled: input?.pushRegistrationEnabled === true,
          },
          liveHandlers,
          { pairingDependencies: input?.pairingDependencies },
        );
        try {
          await candidate.start();
        } catch (error) {
          await candidate.sessions.close();
          throw error;
        }
        return candidate;
      };

      // Reuse the last bound port so endpoints persisted by paired devices
      // stay valid across desktop restarts. If something else took the port,
      // fall back to an ephemeral one rather than failing to start.
      const preferredPort = settingsStore?.load().preferredPort ?? 0;
      let candidate: RemoteGateway;
      try {
        candidate = await startGateway(preferredPort);
      } catch (error) {
        if (preferredPort === 0) {
          enabled = false;
          syncWakeBlocker();
          throw error;
        }
        candidate = await startGateway(0).catch((fallbackError) => {
          enabled = false;
          syncWakeBlocker();
          throw fallbackError;
        });
      }
      gateway = candidate;
      enabled = true;
      const address = candidate.server.address();
      if (address && typeof address !== "string") {
        candidate.config.port = address.port;
      }
      // Enabling Graft Mobile is also the authorization to dial the relay, so
      // there is no second toggle. Registration runs in the background: the
      // gateway must not wait on a network round-trip to report ready.
      relayPending = startRelay(candidate.config.port);
      syncWakeBlocker();
      persistSettings();
      return status();
    },

    setKeepHostAwake(next) {
      keepHostAwake = next;
      syncWakeBlocker();
      persistSettings();
      return status();
    },

    async restorePersistedState() {
      if (!settingsStore || enabled) return;
      if (!settingsStore.load().enabled) return;
      await controller.setEnabled(true);
    },

    async issuePairing() {
      if (!enabled || !gateway) {
        throw new Error("Enable Graft Mobile before creating a pairing link.");
      }
      if (
        relayConfig &&
        relayStatus.state === "disabled" &&
        gateway.config.port != null
      ) {
        relayPending = startRelay(gateway.config.port);
      }
      // Registration is backgrounded so enable stays snappy; pairing waits a
      // bounded interval so the QR is relay-first once the uplink is up.
      await waitForRelayBeforePairing();
      const endpoint = preferredPairingEndpoint(status().endpoints);
      if (!endpoint) {
        throw new Error(
          "No usable relay, local, LAN, or Tailnet endpoint was found.",
        );
      }
      const issued = gateway.issuePairingCredential(undefined, endpoint);
      lastPairingUrl = issued.pairingUrl;
      lastPairingExpiresAt = issued.expiresAt;
      return {
        pairingUrl: issued.pairingUrl,
        expiresAt: issued.expiresAt,
        token: issued.token,
      };
    },

    revokeDevice(deviceId) {
      if (gateway) {
        gateway.revokeDevice(deviceId);
      } else {
        offlinePairing?.revokeDevice(deviceId);
      }
      return status();
    },

    diagnosticsText() {
      const current = status();
      return [
        `enabled=${current.enabled}`,
        `keepHostAwake=${current.keepHostAwake}`,
        `environment=${current.environmentLabel} (${current.environmentId})`,
        `bind=${current.bindHost}:${current.port ?? "-"}`,
        `endpoints=${current.endpoints.map((endpoint) => `${endpoint.kind}:${endpoint.httpBaseUrl}`).join(",") || "-"}`,
        `relay=${current.relay.state}`,
        `relayError=${current.relay.lastError ?? "-"}`,
        `devices=${current.devices.length}`,
        `pairingExpiresAt=${current.pairingExpiresAt ?? "-"}`,
      ].join("\n");
    },

    async onAccountSignedOut() {
      relayEpoch += 1;
      if (relayConfig) {
        clearStoredRelayCredential(relayConfig.registration.secretStore);
      }
      await stopRelay();
      const pending = relayPending;
      relayPending = undefined;
      if (pending) await pending.catch(() => undefined);
      await stopRelay();
      if (relayConfig) {
        clearStoredRelayCredential(relayConfig.registration.secretStore);
      }
      lastPairingUrl = null;
      lastPairingExpiresAt = null;
    },

    async stop() {
      // App shutdown, not a user toggle: leave the persisted intent alone so
      // the gateway restores on the next launch.
      enabled = false;
      await stopGateway();
      syncWakeBlocker();
      offlinePairing?.close();
    },
  };
  return controller;
}
