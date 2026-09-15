import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_GRAFT_HOME_DIRECTORY_NAME,
  GRAFT_HOME_ENV_NAME,
  expandHomePath,
  isAppHomeDirectoryName,
  resolveGraftHomeDirectory,
} from "./graftHome";

const tempDirs = new Set<string>();

function makeTempDir(): string {
  const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "graft-home-test-"));
  tempDirs.add(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs) {
    FS.rmSync(directory, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("expandHomePath", () => {
  it("expands a leading tilde against the supplied home", () => {
    expect(expandHomePath("~", "/users/tester")).toBe("/users/tester");
    expect(expandHomePath("~/Documents/Graft", "/users/tester")).toBe(
      Path.join("/users/tester", "Documents", "Graft"),
    );
  });
});

describe("isAppHomeDirectoryName", () => {
  it("recognizes Graft homes, including flavor suffixes", () => {
    expect(isAppHomeDirectoryName(".graft")).toBe(true);
    expect(isAppHomeDirectoryName(".graft-dev")).toBe(true);
    expect(isAppHomeDirectoryName(".graft-canary")).toBe(true);
    expect(isAppHomeDirectoryName(".cursor")).toBe(false);
    expect(isAppHomeDirectoryName("graft")).toBe(false);
  });

  it("does not treat leftover upstream homes as Graft-owned", () => {
    expect(isAppHomeDirectoryName(".synara")).toBe(false);
    expect(isAppHomeDirectoryName(".synara-canary")).toBe(false);
  });
});

describe("resolveGraftHomeDirectory", () => {
  it("defaults new installs to ~/.graft", () => {
    expect(GRAFT_HOME_ENV_NAME).toBe("GRAFT_HOME");
    expect(DEFAULT_GRAFT_HOME_DIRECTORY_NAME).toBe(".graft");
    expect(resolveGraftHomeDirectory({ env: {}, homeDirectory: "/users/tester" })).toBe(
      Path.join("/users/tester", ".graft"),
    );
  });

  it("honors GRAFT_HOME and explicit configuredHome", () => {
    expect(
      resolveGraftHomeDirectory({
        env: { GRAFT_HOME: "/tmp/custom-graft" },
        homeDirectory: "/users/tester",
      }),
    ).toBe(Path.resolve("/tmp/custom-graft"));
    expect(
      resolveGraftHomeDirectory({
        configuredHome: "~/Documents/Graft",
        env: { GRAFT_HOME: "/tmp/ignored" },
        homeDirectory: "/users/tester",
      }),
    ).toBe(Path.join("/users/tester", "Documents", "Graft"));
    expect(
      resolveGraftHomeDirectory({
        configuredHome: "   ",
        env: { GRAFT_HOME: "/tmp/custom-graft" },
        homeDirectory: "/users/tester",
      }),
    ).toBe(Path.resolve("/tmp/custom-graft"));
  });

  it("does not select leftover storage when the Graft root is absent", () => {
    const homeDirectory = makeTempDir();
    FS.mkdirSync(Path.join(homeDirectory, ".synara"));
    expect(resolveGraftHomeDirectory({ env: {}, homeDirectory })).toBe(
      Path.join(homeDirectory, ".graft"),
    );
  });

  it("keeps development storage separate from an existing leftover home", () => {
    const homeDirectory = makeTempDir();
    FS.mkdirSync(Path.join(homeDirectory, ".synara-dev"));
    expect(
      resolveGraftHomeDirectory({
        env: {},
        homeDirectory,
        directoryName: ".graft-dev",
      }),
    ).toBe(Path.join(homeDirectory, ".graft-dev"));
  });
});
