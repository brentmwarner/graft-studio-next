import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  closeOccupancyRuntime,
  occupancyDatabasePath,
} from "./occupancyRuntime";

const roots: string[] = [];

afterEach(() => {
  closeOccupancyRuntime();
  delete process.env.GRAFT_HOST;
  delete process.env.GRAFT_HOST_DATA_DIR;
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("occupancy database path", () => {
  it("uses a dedicated graft-host database when GRAFT_HOST=1", () => {
    const root = mkdtempSync(join(tmpdir(), "graft-host-data-"));
    roots.push(root);
    process.env.GRAFT_HOST = "1";
    process.env.GRAFT_HOST_DATA_DIR = root;
    expect(occupancyDatabasePath({ stateDir: join(root, "unused") })).toBe(
      join(root, "graft-host.db"),
    );
  });

  it("keeps occupancy next to Synara state for the local desktop", () => {
    const root = mkdtempSync(join(tmpdir(), "graft-occupancy-state-"));
    roots.push(root);
    expect(occupancyDatabasePath({ stateDir: root })).toBe(
      join(root, "graft-desktop-occupancy.sqlite"),
    );
  });
});
