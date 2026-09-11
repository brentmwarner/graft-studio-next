import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { GRAFT_HOST_LINUX_X64_ARCHIVE, GRAFT_HOST_VERSION } from "@graft/desktop-contract";

import type { ServerConfigShape } from "../config";
import { SshMachineStore, defaultSshMachineStorePath } from "./sshMachineStore";
import { SshRemoteConnectionManager } from "./sshRemoteConnectionManager";
import { SshSecretStore, defaultSshSecretStorePath } from "./sshSecretStore";

let manager: SshRemoteConnectionManager | null = null;

export function graftHostArchiveCandidates(fromDir: string): string[] {
  return [
    join(fromDir, GRAFT_HOST_LINUX_X64_ARCHIVE),
    join(fromDir, "../../dist", GRAFT_HOST_LINUX_X64_ARCHIVE),
    join(fromDir, "../../../host/dist", GRAFT_HOST_LINUX_X64_ARCHIVE),
  ];
}

export function resolveGraftHostArchivePath(
  fromDir = import.meta.dirname,
  environment: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string {
  const override = environment.GRAFT_HOST_ARCHIVE?.trim();
  if (override) return override;
  const candidates = graftHostArchiveCandidates(fromDir);
  return candidates.find((candidate) => exists(candidate)) ?? candidates[0]!;
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
