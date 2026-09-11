import { createHash, randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SshHostInstaller } from "./sshHostInstaller.js";
import type { SshCommandRunner } from "./sshTarget.js";

const paths: string[] = [];
const bootstrap = {
  protocolVersion: 1,
  environmentId: "host-fedora-workstation-01",
  environmentLabel: "Fedora workstation",
  daemonVersion: "0.1.0",
  platform: { os: "linux", arch: "x64", libc: "glibc" },
  port: 47_831,
  enrollmentToken: "enrollment-token-value-000000000000000001",
  enrollmentExpiresAt: 1_780_000_000_000,
  activeRunCount: 0,
  activePtyCount: 0,
} as const;

afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { force: true });
});

describe("SshHostInstaller", () => {
  it("uses an existing compatible host without copying a package", async () => {
    const runner = vi.fn<SshCommandRunner>(async () => ({
      stdout: JSON.stringify(bootstrap),
      stderr: "",
      exitCode: 0,
    }));
    const installer = new SshHostInstaller({
      hostArchivePath: "/unused/archive.tgz",
      hostVersion: "0.1.0",
      runner,
    });
    await expect(installer.bootstrap("fedora")).resolves.toEqual(bootstrap);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.[1]).toContain("fedora");
  });

  it("installs when the remote host version is stale", async () => {
    const archive = join(tmpdir(), `graft-host-${randomUUID()}.tgz`);
    paths.push(archive);
    writeFileSync(archive, "package");
    let invocation = 0;
    const runner = vi.fn<SshCommandRunner>(async () => {
      invocation += 1;
      if (invocation === 1) {
        return {
          stdout: JSON.stringify({ ...bootstrap, daemonVersion: "0.0.9" }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (invocation === 4) {
        return { stdout: JSON.stringify(bootstrap), stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const installer = new SshHostInstaller({
      hostArchivePath: archive,
      hostVersion: "0.1.0",
      runner,
    });
    await expect(installer.bootstrap("fedora")).resolves.toEqual(bootstrap);
    expect(runner).toHaveBeenCalledTimes(4);
    expect(runner.mock.calls[1]?.[0]).toBe("scp");
  });

  it("copies and installs the bundled Linux host when bootstrap is absent", async () => {
    const archive = join(tmpdir(), `graft-host-${randomUUID()}.tgz`);
    paths.push(archive);
    writeFileSync(archive, "package");
    let invocation = 0;
    const runner = vi.fn<SshCommandRunner>(async () => {
      invocation += 1;
      if (invocation === 1) return { stdout: "", stderr: "", exitCode: 127 };
      if (invocation === 4) {
        return { stdout: JSON.stringify(bootstrap), stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const installer = new SshHostInstaller({
      hostArchivePath: archive,
      hostVersion: "0.1.0",
      runner,
    });
    await expect(installer.bootstrap("fedora")).resolves.toEqual(bootstrap);
    expect(runner).toHaveBeenCalledTimes(4);
    expect(runner.mock.calls[1]?.[0]).toBe("scp");
    const archiveSha256 = createHash("sha256").update("package").digest("hex");
    expect(runner.mock.calls[2]?.[1].at(-1)).toContain(archiveSha256);
    expect(runner.mock.calls[2]?.[2]?.input?.toString()).not.toContain(
      "npm install",
    );
    expect(runner.mock.calls[2]?.[2]?.input?.toString()).toContain(
      'require("better-sqlite3"); require("node-pty"); require("ws")',
    );
    expect(runner.mock.calls[2]?.[2]?.input?.toString()).toContain(
      'sha256sum "$archive"',
    );
  });

  it("stages an update while active remote work keeps the compatible daemon running", async () => {
    const archive = join(tmpdir(), `graft-host-${randomUUID()}.tgz`);
    paths.push(archive);
    writeFileSync(archive, "package");
    let invocation = 0;
    const runner = vi.fn<SshCommandRunner>(async () => {
      invocation += 1;
      if (invocation === 1) {
        return {
          stdout: JSON.stringify({
            ...bootstrap,
            daemonVersion: "0.0.9",
            activePtyCount: 3,
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (invocation === 4) {
        return {
          stdout: JSON.stringify({
            ...bootstrap,
            daemonVersion: "0.0.9",
            activePtyCount: 3,
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const installer = new SshHostInstaller({
      hostArchivePath: archive,
      hostVersion: "0.1.0",
      runner,
    });

    await expect(installer.bootstrap("fedora")).resolves.toMatchObject({
      daemonVersion: "0.0.9",
      activePtyCount: 3,
    });
    expect(runner).toHaveBeenCalledTimes(4);
    expect(runner.mock.calls[1]?.[0]).toBe("scp");
  });

  it("recovers from an older CLI that blocks before returning bootstrap metadata", async () => {
    const archive = join(tmpdir(), `graft-host-${randomUUID()}.tgz`);
    paths.push(archive);
    writeFileSync(archive, "package");
    let invocation = 0;
    const runner = vi.fn<SshCommandRunner>(async () => {
      invocation += 1;
      if (invocation === 1) {
        return {
          stdout: "",
          stderr:
            "graft-host: GRAFT_HOST_UPGRADE_BLOCKED: close 0 active run(s) and 3 active terminal(s)",
          exitCode: 1,
        };
      }
      if (invocation === 4) {
        return {
          stdout: JSON.stringify({
            ...bootstrap,
            daemonVersion: "0.0.9",
            activePtyCount: 3,
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const installer = new SshHostInstaller({
      hostArchivePath: archive,
      hostVersion: "0.1.0",
      runner,
    });

    await expect(installer.bootstrap("fedora")).resolves.toMatchObject({
      daemonVersion: "0.0.9",
      activePtyCount: 3,
    });
    expect(runner).toHaveBeenCalledTimes(4);
    expect(runner.mock.calls[1]?.[0]).toBe("scp");
  });

  it("rejects a stale daemon that stays mismatched without active work", async () => {
    const archive = join(tmpdir(), `graft-host-${randomUUID()}.tgz`);
    paths.push(archive);
    writeFileSync(archive, "package");
    let invocation = 0;
    const runner = vi.fn<SshCommandRunner>(async () => {
      invocation += 1;
      if (invocation === 1 || invocation === 4) {
        return {
          stdout: JSON.stringify({ ...bootstrap, daemonVersion: "0.0.9" }),
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const installer = new SshHostInstaller({
      hostArchivePath: archive,
      hostVersion: "0.1.0",
      runner,
    });

    await expect(installer.bootstrap("fedora")).rejects.toMatchObject({
      code: "incompatible_host",
      message: "The machine kept running an older graft-host after the update",
      retryable: true,
    });
  });
});
