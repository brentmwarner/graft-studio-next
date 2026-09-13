import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";

import {
  resolveActiveCodexHomeWritePath,
  resolveBaseCodexHomePath,
  resolveCodexHomeAllowlistCandidates,
  resolveSynaraCodexHomeOverlayPath,
} from "./codexHomePaths.ts";

const tempDirs = new Set<string>();

afterEach(() => {
  for (const directory of tempDirs) {
    rmSync(directory, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("Codex home paths", () => {
  it("resolves the source home using explicit, environment, then default precedence", () => {
    assert.equal(
      resolveBaseCodexHomePath({ CODEX_HOME: "/env/codex" }, "/explicit/codex"),
      "/explicit/codex",
    );
    assert.equal(resolveBaseCodexHomePath({ CODEX_HOME: "/env/codex" }), "/env/codex");
    assert.ok(resolveBaseCodexHomePath({}).endsWith(`${path.sep}.codex`));
  });

  it("anchors the overlay under SYNARA_HOME", () => {
    assert.equal(
      resolveSynaraCodexHomeOverlayPath({ SYNARA_HOME: "/synara/runtime" }, "/users/me/.codex"),
      path.join("/synara/runtime", "codex-home-overlay"),
    );
  });

  it("derives a default overlay beside the source home", () => {
    assert.equal(
      resolveSynaraCodexHomeOverlayPath({}, "/users/me/.codex"),
      path.join("/users/me", ".graft", "runtime", "codex-home-overlay"),
    );
  });

  it("reuses an existing .synara/runtime overlay when .graft/runtime is absent", () => {
    const sourceParent = mkdtempSync(path.join(tmpdir(), "graft-codex-overlay-"));
    tempDirs.add(sourceParent);
    const legacyRuntime = path.join(sourceParent, ".synara", "runtime");
    mkdirSync(legacyRuntime, { recursive: true });

    assert.equal(
      resolveSynaraCodexHomeOverlayPath({}, path.join(sourceParent, ".codex")),
      path.join(legacyRuntime, "codex-home-overlay"),
    );
  });

  it("uses the isolated overlay as Codex's write home", () => {
    assert.equal(
      resolveActiveCodexHomeWritePath({
        env: { SYNARA_HOME: "/synara/runtime" },
        homePath: "/users/me/.codex",
      }),
      path.join("/synara/runtime", "codex-home-overlay"),
    );
  });

  it("allowlists source and overlay homes when distinct", () => {
    assert.deepEqual(
      resolveCodexHomeAllowlistCandidates({
        env: { SYNARA_HOME: "/synara/runtime" },
        homePath: "/users/me/.codex",
      }),
      ["/users/me/.codex", path.join("/synara/runtime", "codex-home-overlay")],
    );
  });
});
