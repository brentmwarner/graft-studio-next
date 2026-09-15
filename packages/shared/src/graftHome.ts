// FILE: graftHome.ts
// Purpose: Resolves the user-level Graft base directory without Effect, so the backend
// server and the Electron main process agree on one location during early startup.
// Exports: expandHomePath, resolveGraftHomeDirectory, isAppHomeDirectoryName,
//          GRAFT_HOME_ENV_NAME.

import * as OS from "node:os";
import * as Path from "node:path";

export const GRAFT_HOME_ENV_NAME = "GRAFT_HOME";
export const DEFAULT_GRAFT_HOME_DIRECTORY_NAME = ".graft";

/** Expands a leading `~` against the user's home directory; other inputs pass through. */
export function expandHomePath(input: string, homeDirectory: string = OS.homedir()): string {
  if (input === "~") {
    return homeDirectory;
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return Path.join(homeDirectory, input.slice(2));
  }
  return input;
}

/** True for `.graft` and flavor suffixes (`.graft-dev`, `.graft-canary`). */
export function isAppHomeDirectoryName(directoryName: string): boolean {
  const normalized = directoryName.toLowerCase();
  return (
    normalized === DEFAULT_GRAFT_HOME_DIRECTORY_NAME ||
    normalized.startsWith(`${DEFAULT_GRAFT_HOME_DIRECTORY_NAME}-`)
  );
}

/**
 * Resolves the Graft base directory the same way for every process in the install.
 *
 * Deliberately plain Node: the Electron main process needs this before Effect (or even
 * `app.whenReady()`) is available, and the login-shell environment cache has to land in
 * the same place whichever process wrote it first.
 *
 * `GRAFT_HOME` is the only override. When nothing is configured, new installs use
 * `~/.graft` (or a flavor-specific `.graft-*` name). Leftover roots from other
 * products are never selected implicitly: this product must not open or migrate
 * another app's database.
 */
export function resolveGraftHomeDirectory(
  options: {
    /** Explicit override; falls back to `GRAFT_HOME` from `env`. */
    readonly configuredHome?: string | undefined;
    readonly env?: NodeJS.ProcessEnv;
    readonly homeDirectory?: string;
    /** Flavor-specific default (`.graft-canary`), used only when nothing is configured. */
    readonly directoryName?: string;
  } = {},
): string {
  const homeDirectory = options.homeDirectory ?? OS.homedir();
  const explicit = options.configuredHome?.trim();
  const env = options.env ?? process.env;
  const fromEnv = env[GRAFT_HOME_ENV_NAME]?.trim();
  const configured = explicit || fromEnv;
  if (!configured) {
    const directoryName = options.directoryName ?? DEFAULT_GRAFT_HOME_DIRECTORY_NAME;
    return Path.join(homeDirectory, directoryName);
  }
  return Path.resolve(expandHomePath(configured, homeDirectory));
}
