import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import {
  GRAFT_HOST_BIN,
  GRAFT_HOST_LINUX_X64_ARCHIVE,
  GRAFT_HOST_SERVER_ENTRY,
} from "@graft/desktop-contract";

import { assembleGraftHostLinuxArchive } from "./packLinuxX64";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("graft-host linux archive", () => {
  it("packages host and server binaries and copies the archive to the server runtime path", () => {
    const root = mkdtempSync(join(tmpdir(), "graft-host-pack-"));
    roots.push(root);
    const stagingDir = join(root, "stage");
    mkdirSync(join(stagingDir, "bin"), { recursive: true });
    writeFileSync(join(stagingDir, "bin", GRAFT_HOST_BIN), "host");
    writeFileSync(join(stagingDir, "bin", GRAFT_HOST_SERVER_ENTRY), "server");
    const archivePath = join(root, "host-dist", GRAFT_HOST_LINUX_X64_ARCHIVE);
    const runtimeCopyPath = join(root, "server-dist", GRAFT_HOST_LINUX_X64_ARCHIVE);
    const assembled = assembleGraftHostLinuxArchive({
      stagingDir,
      archivePath,
      runtimeCopyPath,
    });
    const listing = spawnSync("tar", ["-tzf", assembled.archivePath], { encoding: "utf8" });
    expect(listing.status).toBe(0);
    const entries = listing.stdout.split("\n").filter(Boolean);
    expect(entries).toContain(`bin/${GRAFT_HOST_BIN}`);
    expect(entries).toContain(`bin/${GRAFT_HOST_SERVER_ENTRY}`);
    expect(spawnSync("tar", ["-tzf", runtimeCopyPath], { encoding: "utf8" }).status).toBe(0);
  });
});
