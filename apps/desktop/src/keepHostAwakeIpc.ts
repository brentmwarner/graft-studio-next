import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, ipcMain, powerSaveBlocker } from "electron";

import { createKeepHostAwakeController } from "./keepHostAwake";
import { DESKTOP_IPC_CHANNELS } from "./ipcChannels";

const IPC = DESKTOP_IPC_CHANNELS.connections;

function settingsPath(): string {
  return join(app.getPath("userData"), "mobile-gateway.json");
}

function loadKeepHostAwake(): boolean {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), "utf8")) as { keepHostAwake?: unknown };
    return parsed.keepHostAwake === true;
  } catch {
    return false;
  }
}

function saveKeepHostAwake(keepHostAwake: boolean): void {
  try {
    mkdirSync(dirname(settingsPath()), { recursive: true });
    writeFileSync(settingsPath(), `${JSON.stringify({ keepHostAwake }, null, 2)}\n`);
  } catch {
    // Preference is restored as off after the next launch if the write fails.
  }
}

const controller = createKeepHostAwakeController({
  store: { load: loadKeepHostAwake, save: saveKeepHostAwake },
  powerSaveBlocker,
});

export function registerKeepHostAwakeIpcHandlers(): void {
  ipcMain.removeHandler(IPC.getKeepHostAwake);
  ipcMain.handle(IPC.getKeepHostAwake, () => controller.getKeepHostAwake());

  ipcMain.removeHandler(IPC.setKeepHostAwake);
  ipcMain.handle(IPC.setKeepHostAwake, (_event, keepHostAwake: unknown, gatewayEnabled: unknown) =>
    controller.setKeepHostAwake(keepHostAwake === true, gatewayEnabled === true),
  );

  ipcMain.removeHandler(IPC.syncWake);
  ipcMain.handle(IPC.syncWake, (_event, gatewayEnabled: unknown) =>
    controller.sync(gatewayEnabled === true),
  );
}
