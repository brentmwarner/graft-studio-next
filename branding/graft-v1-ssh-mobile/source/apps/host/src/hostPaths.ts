import { homedir, hostname } from "node:os";
import { join } from "node:path";

export interface GraftHostPaths {
  dataRoot: string;
  databasePath: string;
  lockPath: string;
  statePath: string;
  installationRoot: string;
}

export function defaultGraftHostDataRoot(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const xdgDataHome = environment.XDG_DATA_HOME?.trim();
  return xdgDataHome
    ? join(xdgDataHome, "graft", "host")
    : join(homedir(), ".local", "share", "graft", "host");
}

export function resolveGraftHostPaths(dataRoot: string): GraftHostPaths {
  return {
    dataRoot,
    databasePath: join(dataRoot, "graft-host.db"),
    lockPath: join(dataRoot, "daemon.lock"),
    statePath: join(dataRoot, "daemon.json"),
    installationRoot: join(dataRoot, "installation"),
  };
}

export function defaultEnvironmentLabel(): string {
  return hostname() || "Graft host";
}
