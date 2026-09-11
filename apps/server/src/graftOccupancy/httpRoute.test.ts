import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GRAFT_HOST_VERSION } from "@graft/desktop-contract";
import { LINUX_X64_GLIBC_PLATFORM, OccupancyProtocol, OccupancyStore } from "@graft/occupancy";

import { occupancyHealthJson, parseOccupancyBearer } from "./httpRoute";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("occupancy HTTP helpers", () => {
  it("parses occupancy bearers and ignores empty values", () => {
    expect(parseOccupancyBearer("Bearer desktop-token")).toBe("desktop-token");
    expect(parseOccupancyBearer("Bearer ")).toBeNull();
    expect(parseOccupancyBearer("Token desktop-token")).toBeNull();
    expect(parseOccupancyBearer(undefined)).toBeNull();
  });

  it("builds a graft-host health payload that cannot be confused with the mobile gateway", () => {
    const root = mkdtempSync(join(tmpdir(), "graft-occupancy-http-"));
    roots.push(root);
    const store = new OccupancyStore(join(root, "graft-host.db"));
    const protocol = new OccupancyProtocol(store, {
      environmentLabel: "Omarchy",
      daemonVersion: GRAFT_HOST_VERSION,
      port: 4783,
      platform: LINUX_X64_GLIBC_PLATFORM,
      capabilities: ["projects", "diagnostics"],
      enrollmentGrants: ["projects", "diagnostics"],
    });
    protocol.bootstrap();
    const health = occupancyHealthJson({ store, protocol }, 4783);
    expect(health.service).toBe("graft-host");
    expect(health.port).toBe(4783);
    expect(health.environmentLabel).toBe("Omarchy");
    store.close();
  });
});
