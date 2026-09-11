import { homedir, hostname } from "node:os";
import { join } from "node:path";

export interface GraftHostPaths {
  dataRoot: string;
  databasePath: string;
  lockPath: string;
  statePath: string;
  synaraHome: string;
  archivePath: string;
}

export function defaultGraftHostDataRoot(environment: NodeJS.ProcessEnv = process.env): string {
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
    synaraHome: join(dataRoot, "synara"),
    archivePath: join(dataRoot, "graft-host-linux-x64.tar.gz"),
  };
}

export function defaultEnvironmentLabel(): string {
  return hostname() || "Graft host";
}
