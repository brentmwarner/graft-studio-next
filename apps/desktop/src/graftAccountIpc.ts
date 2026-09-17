import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";

import { DESKTOP_IPC_CHANNELS } from "./ipcChannels";
import type { GraftAccountService } from "./graftAccountService";

interface AccountFrame {
  readonly url: string;
}

interface AccountSender {
  readonly mainFrame: AccountFrame;
  isDestroyed(): boolean;
}

export function isTrustedAccountSender(
  event: { readonly sender: unknown; readonly senderFrame: AccountFrame | null },
  owner: AccountSender | null,
  entryUrl: string,
): boolean {
  if (
    !owner ||
    owner.isDestroyed() ||
    event.sender !== owner ||
    !event.senderFrame ||
    event.senderFrame !== owner.mainFrame
  ) {
    return false;
  }
  try {
    const expected = new URL(entryUrl);
    const actual = new URL(event.senderFrame.url);
    return actual.protocol === expected.protocol && actual.host === expected.host;
  } catch {
    return false;
  }
}

export function registerGraftAccountIpc(input: {
  readonly ipcMain: IpcMain;
  readonly account: GraftAccountService;
  readonly getWindow: () => BrowserWindow | null;
  readonly entryUrl: string;
}): void {
  const channels = DESKTOP_IPC_CHANNELS.account;
  const handlers = [
    [channels.connectRelay, () => input.account.connectRelay()],
    [channels.getState, () => input.account.getState()],
    [channels.signIn, () => input.account.signIn()],
    [channels.cancelSignIn, () => input.account.cancelSignIn()],
    [channels.signOut, () => input.account.signOut()],
    [channels.refresh, () => input.account.refresh()],
  ] as const;
  for (const [channel, handler] of handlers) {
    input.ipcMain.removeHandler(channel);
    input.ipcMain.handle(channel, (event: IpcMainInvokeEvent) => {
      if (!isTrustedAccountSender(event, input.getWindow()?.webContents ?? null, input.entryUrl)) {
        throw new Error("Account requests must come from the app window.");
      }
      return handler();
    });
  }
}
