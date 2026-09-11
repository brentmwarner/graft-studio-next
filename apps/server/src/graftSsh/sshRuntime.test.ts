import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GRAFT_HOST_LINUX_X64_ARCHIVE } from "@graft/desktop-contract";

import { graftHostArchiveCandidates, resolveGraftHostArchivePath } from "./sshRuntime";

describe("resolveGraftHostArchivePath", () => {
  it("uses GRAFT_HOST_ARCHIVE when set", () => {
    expect(
      resolveGraftHostArchivePath("/unused", { GRAFT_HOST_ARCHIVE: "/tmp/custom-host.tgz" }),
    ).toBe("/tmp/custom-host.tgz");
  });

  it("prefers an archive next to the built server", () => {
    const dist = mkdtempSync(join(tmpdir(), "graft-host-dist-"));
    const archive = join(dist, GRAFT_HOST_LINUX_X64_ARCHIVE);
    writeFileSync(archive, "archive");
    expect(resolveGraftHostArchivePath(dist)).toBe(archive);
  });

  it("falls back to the source-relative host dist when the server is running from src", () => {
    const root = mkdtempSync(join(tmpdir(), "graft-host-src-"));
    const fromDir = join(root, "apps/server/src/graftSsh");
    const hostDist = join(root, "apps/host/dist");
    mkdirSync(fromDir, { recursive: true });
    mkdirSync(hostDist, { recursive: true });
    const archive = join(hostDist, GRAFT_HOST_LINUX_X64_ARCHIVE);
    writeFileSync(archive, "archive");
    expect(resolveGraftHostArchivePath(fromDir)).toBe(archive);
  });

  it("names the packaged desktop path first so staging next to dist is sufficient", () => {
    expect(graftHostArchiveCandidates("/app/apps/server/dist")[0]).toBe(
      join("/app/apps/server/dist", GRAFT_HOST_LINUX_X64_ARCHIVE),
    );
  });
});
