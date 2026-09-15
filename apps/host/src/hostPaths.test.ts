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
    expect(resolveGraftHostPaths(dataRoot).graftHome).toBe(join(dataRoot, "graft"));
  });

  it("does not adopt an existing leftover subdirectory as the hosted app home", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "graft-host-paths-"));
    roots.push(dataRoot);
    mkdirSync(join(dataRoot, "synara"));
    expect(resolveGraftHostPaths(dataRoot).graftHome).toBe(join(dataRoot, "graft"));
  });
});
