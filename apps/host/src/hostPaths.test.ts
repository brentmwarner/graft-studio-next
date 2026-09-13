import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveGraftHostPaths } from "./hostPaths";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("resolveGraftHostPaths", () => {
  it("defaults the hosted app home to a graft subdirectory", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "graft-host-paths-"));
    roots.push(dataRoot);
    expect(resolveGraftHostPaths(dataRoot).synaraHome).toBe(join(dataRoot, "graft"));
  });

  it("keeps reading an existing synara subdirectory instead of creating a new graft home", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "graft-host-paths-"));
    roots.push(dataRoot);
    mkdirSync(join(dataRoot, "synara"));
    expect(resolveGraftHostPaths(dataRoot).synaraHome).toBe(join(dataRoot, "synara"));
  });
});
