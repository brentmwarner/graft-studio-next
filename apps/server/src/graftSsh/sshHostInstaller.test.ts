import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GRAFT_DESKTOP_PROTOCOL_VERSION,
  GRAFT_HOST_SERVER_ENTRY,
  GRAFT_HOST_VERSION,
} from "@graft/desktop-contract";

import {
  GRAFT_HOST_INSTALL_SCRIPT,
  SshHostInstaller,
  isSupportedGraftHostNodeVersion,
} from "./sshHostInstaller";
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
      if (command.includes("GRAFT_HOST_UNSUPPORTED_PLATFORM")) return ok();
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

  it("replaces an existing same-version directory that is missing the server entry", () => {
    const root = mkdtempSync(join(tmpdir(), "graft-host-install-"));
    roots.push(root);
    const home = join(root, "home");
    const dataHome = join(root, "share");
    const staging = join(root, "payload");
    mkdirSync(join(staging, "bin"), { recursive: true });
    writeFileSync(join(staging, "bin", "graft-host.mjs"), "host\n");
    writeFileSync(join(staging, "bin", GRAFT_HOST_SERVER_ENTRY), "server\n");
    const archive = join(root, "graft-host.tar.gz");
    const packed = spawnSync("tar", ["-czf", archive, "bin"], { cwd: staging, encoding: "utf8" });
    expect(packed.status).toBe(0);

    const target = join(dataHome, "graft/host/installation/versions", GRAFT_HOST_VERSION);
    mkdirSync(join(target, "bin"), { recursive: true });
    writeFileSync(join(target, "bin", "graft-host.mjs"), "stale-host\n");
    mkdirSync(join(home, ".local/bin"), { recursive: true });

    const sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
    const installed = spawnSync("sh", ["-s", "--", GRAFT_HOST_VERSION, archive, "nonce1", sha256], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        XDG_DATA_HOME: dataHome,
      },
      input: GRAFT_HOST_INSTALL_SCRIPT,
    });
    expect(installed.status, installed.stderr).toBe(0);
    expect(existsSync(join(target, "bin", GRAFT_HOST_SERVER_ENTRY))).toBe(true);
    expect(readFileSync(join(target, "bin", "graft-host.mjs"), "utf8")).toBe("host\n");
  });
});

describe("SSH bootstrap diagnostics", () => {
  it("accepts a login banner before the bootstrap JSON", async () => {
    const runner: SshCommandRunner = async (_executable, args) => {
      if (args.at(-1)?.includes("graft-host bootstrap")) {
        return ok(
          `Welcome to this computer\n${JSON.stringify(bootstrapPayload(GRAFT_HOST_VERSION))}\n`,
        );
      }
      return ok();
    };
    const installer = new SshHostInstaller({
      hostArchivePath: "/unused",
      hostVersion: GRAFT_HOST_VERSION,
      runner,
    });
    await expect(installer.bootstrap("test@machine")).resolves.toMatchObject({
      daemonVersion: GRAFT_HOST_VERSION,
    });
  });

  it("checks the remote runtime before copying an archive", async () => {
    const root = mkdtempSync(join(tmpdir(), "graft-host-preflight-"));
    roots.push(root);
    const archive = join(root, "host.tar.gz");
    writeFileSync(archive, "archive");
    const commands: string[] = [];
    const runner: SshCommandRunner = async (executable, args) => {
      commands.push(executable);
      if (args.at(-1)?.includes("graft-host bootstrap"))
        return { exitCode: 127, stdout: "", stderr: "" };
      return { exitCode: 69, stdout: "", stderr: "graft-host requires Node.js" };
    };
    const installer = new SshHostInstaller({
      hostArchivePath: archive,
      hostVersion: GRAFT_HOST_VERSION,
      runner,
    });
    await expect(installer.bootstrap("test@machine")).rejects.toMatchObject({
      code: "install_failed",
      message: expect.stringContaining("Node.js"),
    });
    expect(commands).toEqual(["ssh", "ssh"]);
  });

  it("runs bootstrap scripts through a POSIX shell even with another remote login shell", async () => {
    const runner: SshCommandRunner = async (_executable, args) => {
      const command = args.at(-1)!;
      expect(command).toMatch(/^sh -c '/u);
      const parsed = spawnSync("sh", ["-n", "-c", command], { encoding: "utf8" });
      expect(parsed.status, parsed.stderr).toBe(0);
      return command.includes("graft-host bootstrap")
        ? ok(JSON.stringify(bootstrapPayload(GRAFT_HOST_VERSION)))
        : ok();
    };
    const installer = new SshHostInstaller({
      hostArchivePath: "/unused",
      hostVersion: GRAFT_HOST_VERSION,
      runner,
    });
    await installer.bootstrap("test@machine");
  });
});
