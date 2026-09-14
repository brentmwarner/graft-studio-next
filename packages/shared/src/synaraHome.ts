// FILE: synaraHome.ts
// Purpose: Resolves the user-level Graft base directory without Effect, so the backend
// server and the Electron main process agree on one location during early startup.
// Exports: expandHomePath, resolveSynaraHomeDirectory, isAppHomeDirectoryName,
//          SYNARA_HOME_ENV_NAME.

import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

export const SYNARA_HOME_ENV_NAME = "SYNARA_HOME";
export const DEFAULT_SYNARA_HOME_DIRECTORY_NAME = ".graft";
export const LEGACY_SYNARA_HOME_DIRECTORY_NAME = ".synara";

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

/**
 * Maps a Graft-branded home directory name back to the Synara name used before
 * the default-root rename (`.graft` → `.synara`, `.graft-dev` → `.synara-dev`).
 */
/** True for `.graft`, `.synara`, and flavor suffixes (`.graft-dev`, `.synara-canary`). */
export function isAppHomeDirectoryName(directoryName: string): boolean {
  const normalized = directoryName.toLowerCase();
  return (
    normalized === DEFAULT_SYNARA_HOME_DIRECTORY_NAME ||
    normalized === LEGACY_SYNARA_HOME_DIRECTORY_NAME ||
    normalized.startsWith(`${DEFAULT_SYNARA_HOME_DIRECTORY_NAME}-`) ||
    normalized.startsWith(`${LEGACY_SYNARA_HOME_DIRECTORY_NAME}-`)
  );
}

export function legacySynaraHomeDirectoryName(directoryName: string): string {
  if (directoryName === DEFAULT_SYNARA_HOME_DIRECTORY_NAME) {
    return LEGACY_SYNARA_HOME_DIRECTORY_NAME;
  }
  if (directoryName.startsWith(`${DEFAULT_SYNARA_HOME_DIRECTORY_NAME}-`)) {
    return `${LEGACY_SYNARA_HOME_DIRECTORY_NAME}${directoryName.slice(DEFAULT_SYNARA_HOME_DIRECTORY_NAME.length)}`;
  }
  return directoryName;
}

/**
 * Prefer the new Graft path; keep reading an existing Synara path when the
 * Graft root has not been created yet. Does not move or delete either root.
 * Any existing Graft path wins, including an empty directory — `mkdir ~/.graft`
 * (or `Documents/Graft`) will strand leftover Synara data until that root is
 * removed.
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
 * `GRAFT_HOME` takes precedence; `SYNARA_HOME` remains a backend compatibility
 * override. When nothing is configured, new installs use
 * `~/.graft` (or a flavor-specific `.graft-*` name). Synara roots are never
 * selected implicitly: a fork must not open or migrate the upstream database.
 */
export function resolveSynaraHomeDirectory(
  options: {
    /** Explicit override; falls back to `SYNARA_HOME` from `env`. */
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
  const fromEnv = env.GRAFT_HOME?.trim() || env[SYNARA_HOME_ENV_NAME]?.trim();
  const configured = explicit || fromEnv;
  if (!configured) {
    const directoryName = options.directoryName ?? DEFAULT_SYNARA_HOME_DIRECTORY_NAME;
    return Path.join(homeDirectory, directoryName);
  }
  return Path.resolve(expandHomePath(configured, homeDirectory));
}
