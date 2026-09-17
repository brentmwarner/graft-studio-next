// FILE: backendEntryPath.ts
// Purpose: Resolves the physical packaged server entry used by the desktop backend.
// Layer: Desktop process boundary helper

import * as Path from "node:path";

export function resolveDesktopBackendEntry(appRoot: string, isPackaged: boolean): string {
  const serverRoot =
    isPackaged && Path.basename(appRoot) === "app.asar" ? `${appRoot}.unpacked` : appRoot;
  return Path.join(serverRoot, "apps/server/dist/index.mjs");
}
