// FILE: desktopBackendExecutable.ts
// Purpose: Resolves the Electron executable used to run the desktop backend.
// Layer: Desktop main process

import * as Path from "node:path";

import { GRAFT_MAC_BACKEND_NODE_RUNTIME_RELATIVE_PATH } from "@graft/shared/desktopIdentity";

export interface DesktopBackendExecutableInput {
  readonly appIsPackaged: boolean;
  readonly execPath: string;
  readonly platform: NodeJS.Platform;
  readonly resourcesPath: string;
}

export interface DesktopBackendEntryInput {
  readonly appIsPackaged: boolean;
  readonly appRoot: string;
  readonly platform: NodeJS.Platform;
  readonly resourcesPath: string;
}

export interface DesktopBackendRuntimeEnvironmentInput {
  readonly appIsPackaged: boolean;
  readonly platform: NodeJS.Platform;
}

/**
 * Electron's embedded Node runtime can stall while applying SQLite migrations
 * in a packaged Helper process. macOS packages include a matching standalone
 * Node runtime so the backend does not depend on Electron process behavior.
 */
export function resolveDesktopBackendExecutable(input: DesktopBackendExecutableInput): string {
  if (!input.appIsPackaged || input.platform !== "darwin") {
    return input.execPath;
  }

  return Path.join(input.resourcesPath, GRAFT_MAC_BACKEND_NODE_RUNTIME_RELATIVE_PATH);
}

/**
 * Electron requires this marker when its own executable hosts the backend. The
 * packaged macOS backend uses a standalone Node binary, where retaining the
 * Electron marker can make imported runtime code select the wrong host mode.
 */
export function configureDesktopBackendRuntimeEnvironment(
  environment: NodeJS.ProcessEnv,
  input: DesktopBackendRuntimeEnvironmentInput,
): NodeJS.ProcessEnv {
  const configured = { ...environment };
  if (input.appIsPackaged && input.platform === "darwin") {
    delete configured.ELECTRON_RUN_AS_NODE;
  } else {
    configured.ELECTRON_RUN_AS_NODE = "1";
  }
  return configured;
}

/** Standalone Node cannot read Electron ASAR archives, so use the unpacked server graph. */
export function resolveDesktopBackendEntry(input: DesktopBackendEntryInput): string {
  const relativeEntry = Path.join("apps", "server", "dist", "index.mjs");
  if (!input.appIsPackaged || input.platform !== "darwin") {
    return Path.join(input.appRoot, relativeEntry);
  }
  return Path.join(input.resourcesPath, "app.asar.unpacked", relativeEntry);
}
