import { hostname } from "node:os";
import { join } from "node:path";
import { app, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from "electron";

import { DESKTOP_IPC_CHANNELS } from "../ipcChannels";
import { MobileRelayController } from "./controller";
import { EncryptedFileRemoteSessionSecretStore } from "./remoteSessionSecretStore";

export function registerMobileRelayIpc(input: {
  getBackend: () => { httpBaseUrl: string; token: string };
  authorize: (event: IpcMainInvokeEvent) => boolean;
}): MobileRelayController {
  const controller = new MobileRelayController({
    controlPlaneBaseUrl: process.env.GRAFT_CONTROL_PLANE_URL || "https://api.graftapp.io",
    label: hostname(),
    secretStore: new EncryptedFileRemoteSessionSecretStore({
      filePath: join(app.getPath("userData"), "mobile-relay", "secrets.json"),
      safeStorage,
    }),
    openExternal: (url) => shell.openExternal(url),
    requestBackend: async (path, body) => {
      const backend = input.getBackend();
      const url = new URL(path, backend.httpBaseUrl);
      url.searchParams.set("token", backend.token);
      const response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        ...(body === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`Graft gateway returned ${response.status}.`);
      return response.json();
    },
  });
  const channels = DESKTOP_IPC_CHANNELS.connections;
  const handlers = [
    [channels.getRelayAccount, () => controller.getAccountStatus()],
    [channels.signInRelay, () => controller.signIn()],
    [channels.signOutRelay, () => controller.signOut()],
    [channels.syncRelay, () => controller.sync()],
  ] as const;
  for (const [channel, handler] of handlers) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event) => {
      if (!input.authorize(event)) throw new Error("Unauthorized IPC sender.");
      return handler();
    });
  }
  controller.start();
  return controller;
}
