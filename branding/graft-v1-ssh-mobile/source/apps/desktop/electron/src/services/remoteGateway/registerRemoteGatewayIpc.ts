import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { GraftTimelineEvent } from "@graft/shared";
import type { RendererSenderPolicy } from "@electron/ipc/senderPolicy";
import { IPC_CHANNELS } from "../../ipc/fixedChannels.js";
import {
  createRemoteGatewayController,
  type RemoteGatewayController,
} from "./remoteGatewayController.js";
import type { PairingServiceDependencies } from "./pairingService.js";
import type { RelayRegistrationDependencies } from "./relayRegistration.js";
import type { RemoteGatewaySettingsStore } from "./remoteGatewaySettingsStore.js";
import type { RemoteGatewayHandlers } from "./types.js";

let controller: RemoteGatewayController | undefined;

export function registerRemoteGatewayIpc(
  rendererSenderPolicy: RendererSenderPolicy,
  options?: {
    pairingDependencies?: PairingServiceDependencies;
    pushRegistrationEnabled?: boolean;
    handlers?: RemoteGatewayHandlers;
    settingsStore?: RemoteGatewaySettingsStore;
    relayRegistration?: RelayRegistrationDependencies;
  },
): void {
  if (!controller) {
    controller = createRemoteGatewayController({
      pairingDependencies: options?.pairingDependencies,
      pushRegistrationEnabled: options?.pushRegistrationEnabled,
      handlers: options?.handlers,
      settingsStore: options?.settingsStore,
      relay: options?.relayRegistration
        ? { registration: options.relayRegistration }
        : undefined,
    });
    // Bring the gateway back up without user interaction when it was enabled
    // before the last quit, so paired devices reconnect on their own.
    void controller.restorePersistedState().catch((error) => {
      console.error("remote gateway: failed to restore persisted state", error);
    });
  } else if (options?.handlers) {
    controller.setHandlers(options.handlers);
  }
  const gateway = controller;

  const authorize = (event: IpcMainInvokeEvent) =>
    rendererSenderPolicy.authorizeRendererSender(event);

  ipcMain.removeHandler(IPC_CHANNELS.REMOTE_GATEWAY_GET_STATUS);
  ipcMain.handle(IPC_CHANNELS.REMOTE_GATEWAY_GET_STATUS, (event) => {
    if (!authorize(event)) {
      throw new Error("Unauthorized IPC sender");
    }
    return gateway.getStatus();
  });

  ipcMain.removeHandler(IPC_CHANNELS.REMOTE_GATEWAY_SET_ENABLED);
  ipcMain.handle(
    IPC_CHANNELS.REMOTE_GATEWAY_SET_ENABLED,
    async (event, enabled: unknown) => {
      if (!authorize(event)) {
        throw new Error("Unauthorized IPC sender");
      }
      if (typeof enabled !== "boolean") {
        throw new Error("enabled must be a boolean");
      }
      return gateway.setEnabled(enabled);
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.REMOTE_GATEWAY_SET_KEEP_HOST_AWAKE);
  ipcMain.handle(
    IPC_CHANNELS.REMOTE_GATEWAY_SET_KEEP_HOST_AWAKE,
    (event, enabled: unknown) => {
      if (!authorize(event)) {
        throw new Error("Unauthorized IPC sender");
      }
      if (typeof enabled !== "boolean") {
        throw new Error("keepHostAwake must be a boolean");
      }
      return gateway.setKeepHostAwake(enabled);
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.REMOTE_GATEWAY_ISSUE_PAIRING);
  ipcMain.handle(IPC_CHANNELS.REMOTE_GATEWAY_ISSUE_PAIRING, async (event) => {
    if (!authorize(event)) {
      throw new Error("Unauthorized IPC sender");
    }
    return gateway.issuePairing();
  });

  ipcMain.removeHandler(IPC_CHANNELS.REMOTE_GATEWAY_REVOKE_DEVICE);
  ipcMain.handle(
    IPC_CHANNELS.REMOTE_GATEWAY_REVOKE_DEVICE,
    (event, deviceId: unknown) => {
      if (!authorize(event)) {
        throw new Error("Unauthorized IPC sender");
      }
      if (typeof deviceId !== "string" || deviceId.length === 0) {
        throw new Error("deviceId must be a non-empty string");
      }
      return gateway.revokeDevice(deviceId);
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.REMOTE_GATEWAY_DIAGNOSTICS);
  ipcMain.handle(IPC_CHANNELS.REMOTE_GATEWAY_DIAGNOSTICS, (event) => {
    if (!authorize(event)) {
      throw new Error("Unauthorized IPC sender");
    }
    return gateway.diagnosticsText();
  });
}

/** Inject live desktop domain handlers after `IpcController` is constructed. */
export function configureRemoteGatewayHandlers(
  handlers: RemoteGatewayHandlers,
): void {
  if (!controller) {
    throw new Error("Remote gateway controller is not registered");
  }
  controller.setHandlers(handlers);
}

/** Append + broadcast a timeline event when the gateway is enabled. */
export function publishRemoteGatewayEvent(
  event: Omit<GraftTimelineEvent, "cursor">,
): GraftTimelineEvent | null {
  return controller?.publishEvent(event) ?? null;
}

/** Latest cursor in the active gateway's event journal. */
export function currentRemoteGatewayCursor(): number {
  return controller?.latestCursor() ?? 0;
}

export async function stopRemoteGatewayController(): Promise<void> {
  if (!controller) return;
  const activeController = controller;
  controller = undefined;
  await activeController.stop();
}

/** Sign-out: drop the uplink secret and disconnect the managed relay. */
export async function notifyRemoteGatewaySignedOut(): Promise<void> {
  await controller?.onAccountSignedOut();
}
