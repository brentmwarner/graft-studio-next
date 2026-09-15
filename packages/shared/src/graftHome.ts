// FILE: graftHome.ts
// Purpose: Resolves the user-level Graft base directory without Effect, so the backend
// server and the Electron main process agree on one location during early startup.
// Exports: expandHomePath, resolveGraftHomeDirectory, isAppHomeDirectoryName,
//          GRAFT_HOME_ENV_NAME.

import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

export const GRAFT_HOME_ENV_NAME = "GRAFT_HOME";
export const DEFAULT_GRAFT_HOME_DIRECTORY_NAME = ".graft";
export const LEGACY_HOME_DIRECTORY_NAME = ".synara";

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

/** True for `.graft`, `.synara`, and flavor suffixes (`.graft-dev`, `.synara-canary`). */
export function isAppHomeDirectoryName(directoryName: string): boolean {
  const normalized = directoryName.toLowerCase();
  return (
    normalized === DEFAULT_GRAFT_HOME_DIRECTORY_NAME ||
    normalized === LEGACY_HOME_DIRECTORY_NAME ||
    normalized.startsWith(`${DEFAULT_GRAFT_HOME_DIRECTORY_NAME}-`) ||
    normalized.startsWith(`${LEGACY_HOME_DIRECTORY_NAME}-`)
  );
}

export function legacyHomeDirectoryName(directoryName: string): string {
  if (directoryName === DEFAULT_GRAFT_HOME_DIRECTORY_NAME) {
    return LEGACY_HOME_DIRECTORY_NAME;
  }
  if (directoryName.startsWith(`${DEFAULT_GRAFT_HOME_DIRECTORY_NAME}-`)) {
    return `${LEGACY_HOME_DIRECTORY_NAME}${directoryName.slice(DEFAULT_GRAFT_HOME_DIRECTORY_NAME.length)}`;
  }
  return directoryName;
}

/**
 * Prefer the Graft path; keep reading an existing leftover root when the Graft
 * root has not been created yet. Does not move or delete either root.
 * Any existing Graft path wins, including an empty directory.
 */
export function preferExistingPath(preferred: string, legacy: string): string {
  if (FS.existsSync(preferred) || !FS.existsSync(legacy)) {
    return preferred;
  }
  return legacy;
}

/**
 * Resolves the Graft base directory the same way for every process in the install.
 *
 * Deliberately plain Node: the Electron main process needs this before Effect (or even
 * `app.whenReady()`) is available, and the login-shell environment cache has to land in
 * the same place whichever process wrote it first.
 *
 * `GRAFT_HOME` is the only override. When nothing is configured, new installs use
 * `~/.graft` (or a flavor-specific `.graft-*` name). Upstream leftover roots are never
 * selected implicitly: this product must not open or migrate another app's database.
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
