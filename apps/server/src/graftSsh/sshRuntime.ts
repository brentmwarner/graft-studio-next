import { hostname } from "node:os";
import { join } from "node:path";

import { GRAFT_HOST_VERSION } from "@graft/desktop-contract";

import type { ServerConfigShape } from "../config";
import { SshMachineStore, defaultSshMachineStorePath } from "./sshMachineStore";
import { SshRemoteConnectionManager } from "./sshRemoteConnectionManager";
import { SshSecretStore, defaultSshSecretStorePath } from "./sshSecretStore";

let manager: SshRemoteConnectionManager | null = null;

export function resolveGraftHostArchivePath(
  fromDir = import.meta.dirname,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const override = environment.GRAFT_HOST_ARCHIVE?.trim();
  if (override) return override;
  return join(fromDir, "../../../host/dist/graft-host-linux-x64.tar.gz");
}

export function sshConnectionManager(config: Pick<ServerConfigShape, "stateDir" | "secretsDir">) {
  if (manager) return manager;
  manager = new SshRemoteConnectionManager({
    machineStore: new SshMachineStore(defaultSshMachineStorePath(config.stateDir)),
    secretStore: new SshSecretStore(defaultSshSecretStorePath(config.secretsDir)),
    hostArchivePath: resolveGraftHostArchivePath(),
    hostVersion: GRAFT_HOST_VERSION,
    clientId: `synara-${hostname()}`,
    clientLabel: hostname() || "Graft",
    clientVersion: GRAFT_HOST_VERSION,
  });
  return manager;
}

export async function closeSshConnectionManager(): Promise<void> {
  await manager?.closeAll();
  manager = null;
}
