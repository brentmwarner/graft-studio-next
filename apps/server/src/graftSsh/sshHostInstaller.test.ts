import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GRAFT_DESKTOP_PROTOCOL_VERSION,
  GRAFT_HOST_SERVER_ENTRY,
  GRAFT_HOST_VERSION,
} from "@graft/desktop-contract";

import { SshHostInstaller, isSupportedGraftHostNodeVersion } from "./sshHostInstaller";
import type { SshCommandResult, SshCommandRunner } from "./sshTarget";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function bootstrapPayload(daemonVersion: string) {
  return {
    protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
    environmentId: "host-fedora-workstation-01",
    environmentLabel: "Fedora workstation",
    daemonVersion,
    platform: { os: "linux" as const, arch: "x64" as const, libc: "glibc" as const },
    port: 47_831,
    enrollmentToken: "enrollment-token-value-000000000000000001",
    enrollmentExpiresAt: Date.now() + 10_000,
    activeRunCount: 0,
    activePtyCount: 0,
  };
}

function ok(stdout = "", stderr = ""): SshCommandResult {
  return { exitCode: 0, stdout, stderr };
}

describe("graft-host Node engine check", () => {
  it("accepts the same Node lines as the server engines field", () => {
    expect(isSupportedGraftHostNodeVersion("22.19.0")).toBe(true);
    expect(isSupportedGraftHostNodeVersion("22.18.3")).toBe(false);
    expect(isSupportedGraftHostNodeVersion("23.11.0")).toBe(true);
    expect(isSupportedGraftHostNodeVersion("23.10.0")).toBe(false);
    expect(isSupportedGraftHostNodeVersion("24.10.0")).toBe(true);
    expect(isSupportedGraftHostNodeVersion("24.9.1")).toBe(false);
    expect(isSupportedGraftHostNodeVersion("25.0.0")).toBe(true);
  });
});

describe("graft-host SSH installer", () => {
  it("reinstalls a same-version host that is missing graft-server.mjs", async () => {
    const root = mkdtempSync(join(tmpdir(), "graft-host-archive-"));
    roots.push(root);
    const hostArchivePath = join(root, "graft-host-linux-x64.tar.gz");
    writeFileSync(hostArchivePath, "archive");

    const commands: string[] = [];
    let probes = 0;
    let installs = 0;
    const runner: SshCommandRunner = async (executable, arguments_) => {
      const command = arguments_.at(-1) ?? "";
      commands.push(`${executable} ${command}`);
      if (executable.endsWith("scp") || executable === "scp") {
        installs += 1;
        return ok();
      }
      if (command.includes(GRAFT_HOST_SERVER_ENTRY) && command.includes("hostbin")) {
        probes += 1;
        if (probes === 1) {
          return { exitCode: 127, stdout: "", stderr: "GRAFT_HOST_MISSING_SERVER_ENTRY" };
        }
        return ok();
      }
      if (command.includes("graft-host bootstrap")) {
        return ok(`${JSON.stringify(bootstrapPayload(GRAFT_HOST_VERSION))}\n`);
      }
      if (command.startsWith("sh -s --")) {
        installs += 1;
        return ok();
      }
      return { exitCode: 1, stdout: "", stderr: `unexpected ${command}` };
    };

    const installer = new SshHostInstaller({
      hostArchivePath,
      hostVersion: GRAFT_HOST_VERSION,
      runner,
    });
    const bootstrap = await installer.bootstrap("fedora@workstation");
    expect(bootstrap.daemonVersion).toBe(GRAFT_HOST_VERSION);
    expect(probes).toBe(2);
    expect(installs).toBeGreaterThanOrEqual(2);
    expect(commands.some((command) => command.includes(GRAFT_HOST_SERVER_ENTRY))).toBe(true);
  });
});
