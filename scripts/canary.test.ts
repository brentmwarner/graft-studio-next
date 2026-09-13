import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  canaryCloneArgs,
  canaryStartArgs,
  parseCanaryArgs,
  resolveCanaryPaths,
  resolveCanaryRef,
} from "./canary";

const tempDirs = new Set<string>();

afterEach(() => {
  for (const directory of tempDirs) {
    FS.rmSync(directory, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("canary tooling", () => {
  it("keeps managed source and Canary data separate from Stable", () => {
    expect(resolveCanaryPaths({}, "/Users/tester")).toEqual({
      home: "/Users/tester/.graft-canary",
      source: "/Users/tester/.cache/synara-canary/source",
      state: "/Users/tester/.graft-canary/canary-state.json",
      pid: "/Users/tester/.graft-canary/canary.pid",
      log: "/Users/tester/.graft-canary/canary.log",
    });
  });

  it("reuses an existing ~/.synara-canary until ~/.graft-canary exists", () => {
    const homeDirectory = FS.mkdtempSync(Path.join(OS.tmpdir(), "graft-canary-home-"));
    tempDirs.add(homeDirectory);
    FS.mkdirSync(Path.join(homeDirectory, ".synara-canary"));

    expect(resolveCanaryPaths({}, homeDirectory).home).toBe(
      Path.join(homeDirectory, ".synara-canary"),
    );
  });

  it("supports explicit path overrides", () => {
    expect(
      resolveCanaryPaths(
        {
          SYNARA_CANARY_HOME: "/tmp/canary-data",
          SYNARA_CANARY_SOURCE: "/tmp/canary-source",
        },
        "/Users/tester",
      ),
    ).toEqual({
      home: "/tmp/canary-data",
      source: "/tmp/canary-source",
      state: "/tmp/canary-data/canary-state.json",
      pid: "/tmp/canary-data/canary.pid",
      log: "/tmp/canary-data/canary.log",
    });
  });

  it("tracks main by default and accepts a stacked PR ref", () => {
    expect(parseCanaryArgs(["update"])).toEqual({ command: "update", ref: null });
    expect(parseCanaryArgs(["setup", "--ref", "codex/synara-canary"])).toEqual({
      command: "setup",
      ref: "codex/synara-canary",
    });
  });

  it("checks out the managed source during clone so the cleanliness guard starts clean", () => {
    expect(canaryCloneArgs("git@example.com:synara.git", "/tmp/canary-source")).toEqual([
      "clone",
      "--",
      "git@example.com:synara.git",
      "/tmp/canary-source",
    ]);
  });

  it("starts the desktop launcher directly so the persisted PID stays alive", () => {
    expect(canaryStartArgs()).toEqual(["apps/desktop/scripts/start-electron.mjs"]);
  });

  it("keeps updating the selected stacked ref until explicitly moved to main", () => {
    expect(resolveCanaryRef(parseCanaryArgs(["setup"]), null)).toBe("main");
    expect(resolveCanaryRef(parseCanaryArgs(["update"]), "codex/synara-canary")).toBe(
      "codex/synara-canary",
    );
    expect(resolveCanaryRef(parseCanaryArgs(["update", "--ref", "main"]), "old-ref")).toBe("main");
  });

  it("rejects unsupported commands and incomplete refs", () => {
    expect(() => parseCanaryArgs(["reset"])).toThrow(/Unknown Canary command/u);
    expect(() => parseCanaryArgs(["update", "--ref"])).toThrow(/Missing value/u);
  });
});
