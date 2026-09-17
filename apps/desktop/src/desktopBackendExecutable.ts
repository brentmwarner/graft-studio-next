// FILE: desktopBackendExecutable.ts
// Purpose: Resolves the Electron executable used to run the desktop backend.
// Layer: Desktop main process

import * as Path from "node:path";

export interface DesktopBackendExecutableInput {
  readonly appIsPackaged: boolean;
  readonly execPath: string;
  readonly platform: NodeJS.Platform;
}

/**
 * The packaged macOS app's primary executable and utility process can stall
 * while loading the server module graph. Electron's primary Helper provides
 * the same Node runtime in ELECTRON_RUN_AS_NODE mode without that loader path.
 */
export function resolveDesktopBackendExecutable(input: DesktopBackendExecutableInput): string {
  if (!input.appIsPackaged || input.platform !== "darwin") {
    return input.execPath;
  }

  const executableName = Path.basename(input.execPath);
  const contentsDirectory = Path.dirname(Path.dirname(input.execPath));
  const helperName = `${executableName} Helper`;
  return Path.join(
    contentsDirectory,
    "Frameworks",
    `${helperName}.app`,
    "Contents",
    "MacOS",
    helperName,
  );
}
