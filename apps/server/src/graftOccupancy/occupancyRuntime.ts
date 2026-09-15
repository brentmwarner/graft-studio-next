import { join } from "node:path";

import { GRAFT_HOST_VERSION } from "@graft/desktop-contract";
import {
  HEADLESS_HOST_CAPABILITIES,
  LINUX_X64_GLIBC_PLATFORM,
  OccupancyProtocol,
  OccupancyStore,
} from "@graft/occupancy";
import type { OrchestrationShellSnapshot } from "@graft/contracts";

import type { ServerConfigShape } from "../config";
import { dispatchOccupancyCommand } from "./occupancyDispatch";

export interface OccupancyRuntime {
  readonly store: OccupancyStore;
  readonly protocol: OccupancyProtocol;
}

let listenPort = 0;
let runtime: OccupancyRuntime | null = null;

export function occupancyDatabasePath(config: Pick<ServerConfigShape, "stateDir">): string {
  if (process.env.GRAFT_HOST === "1") {
    const dataDir = process.env.GRAFT_HOST_DATA_DIR?.trim();
    if (!dataDir) {
      throw new Error("GRAFT_HOST_DATA_DIR is required when GRAFT_HOST=1");
    }
    return join(dataDir, "graft-host.db");
  }
  return join(config.stateDir, "graft-desktop-occupancy.sqlite");
}

export function setOccupancyListenPort(port: number): void {
  listenPort = port;
}

export function getOccupancyListenPort(): number {
  return listenPort;
}

export function occupancyRuntime(
  config: Pick<ServerConfigShape, "stateDir" | "port">,
  environmentLabel: string,
  loadShell: () => Promise<OrchestrationShellSnapshot>,
): OccupancyRuntime {
  if (runtime) return runtime;
  const store = new OccupancyStore(occupancyDatabasePath(config));
  const protocol = new OccupancyProtocol(store, {
    environmentLabel,
    daemonVersion: GRAFT_HOST_VERSION,
    port: () => listenPort || config.port,
    platform: LINUX_X64_GLIBC_PLATFORM,
    capabilities: HEADLESS_HOST_CAPABILITIES,
    enrollmentGrants: [...HEADLESS_HOST_CAPABILITIES],
    dispatchCommand: (session, command) => dispatchOccupancyCommand(loadShell, session, command),
  });
  runtime = { store, protocol };
  return runtime;
}

export function closeOccupancyRuntime(): void {
  runtime?.store.close();
  runtime = null;
  listenPort = 0;
}
