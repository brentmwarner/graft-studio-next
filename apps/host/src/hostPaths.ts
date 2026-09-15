import { existsSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

export interface GraftHostPaths {
  dataRoot: string;
  databasePath: string;
  lockPath: string;
  statePath: string;
  graftHome: string;
  archivePath: string;
}

export function defaultGraftHostDataRoot(environment: NodeJS.ProcessEnv = process.env): string {
  const xdgDataHome = environment.XDG_DATA_HOME?.trim();
  return xdgDataHome
    ? join(xdgDataHome, "graft", "host")
    : join(homedir(), ".local", "share", "graft", "host");
}

function preferExistingHostHome(dataRoot: string): string {
  const preferred = join(dataRoot, "graft");
  const legacy = join(dataRoot, "synara");
  if (existsSync(preferred) || !existsSync(legacy)) {
    return preferred;
  }
  return legacy;
}

export function resolveGraftHostPaths(dataRoot: string): GraftHostPaths {
  return {
    dataRoot,
    databasePath: join(dataRoot, "graft-host.db"),
    lockPath: join(dataRoot, "daemon.lock"),
    statePath: join(dataRoot, "daemon.json"),
    graftHome: preferExistingHostHome(dataRoot),
    archivePath: join(dataRoot, "graft-host-linux-x64.tar.gz"),
  };
}

export function defaultEnvironmentLabel(): string {
  return hostname() || "Graft host";
}
