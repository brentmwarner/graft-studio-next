import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GRAFT_DESKTOP_PROTOCOL_VERSION, GRAFT_HOST_VERSION } from "@graft/desktop-contract";
import { OccupancyStore } from "@graft/occupancy";

import { issueBootstrap, parseHostArguments } from "./cli";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("graft-host CLI", () => {
  it("parses bootstrap options without treating fixture ports as product names", () => {
    const parsed = parseHostArguments([
      "bootstrap",
      "--data-dir",
      "/tmp/graft-host-test",
      "--port",
      "4783",
      "--json",
    ]);
    expect(parsed).toMatchObject({
      command: "bootstrap",
      port: 4783,
      json: true,
    });
  });

  it("issues a one-use occupancy token from the durable store", () => {
    const root = mkdtempSync(join(tmpdir(), "graft-host-bootstrap-"));
    roots.push(root);
    const databasePath = join(root, "graft-host.db");
    const store = new OccupancyStore(databasePath);
    const identity = store.getOrCreateIdentity("Omarchy");
    store.close();
    const bootstrap = issueBootstrap(databasePath, {
      service: "graft-host",
      protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
      daemonVersion: GRAFT_HOST_VERSION,
      environmentId: identity.environmentId,
      environmentLabel: identity.environmentLabel,
      platform: { os: "linux", arch: "x64", libc: "glibc" },
      port: 4783,
      capabilities: ["projects", "diagnostics"],
      cursor: 0,
      replayFloor: 0,
      activeRunCount: 0,
      activePtyCount: 0,
    });
    expect(bootstrap.environmentId).toBe(identity.environmentId);
    expect(bootstrap.enrollmentToken.length).toBeGreaterThanOrEqual(32);
    expect(bootstrap.port).toBe(4783);
  });
});
