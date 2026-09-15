import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_GRAFT_HOME_DIRECTORY_NAME,
  GRAFT_HOME_ENV_NAME,
  LEGACY_HOME_DIRECTORY_NAME,
  expandHomePath,
  isAppHomeDirectoryName,
  legacyHomeDirectoryName,
  preferExistingPath,
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
  it("recognizes Graft homes and leftover upstream homes, including flavor suffixes", () => {
    expect(isAppHomeDirectoryName(".graft")).toBe(true);
    expect(isAppHomeDirectoryName(".synara")).toBe(true);
    expect(isAppHomeDirectoryName(".graft-dev")).toBe(true);
    expect(isAppHomeDirectoryName(".synara-canary")).toBe(true);
    expect(isAppHomeDirectoryName(".cursor")).toBe(false);
    expect(isAppHomeDirectoryName("graft")).toBe(false);
  });
});

describe("legacyHomeDirectoryName", () => {
  it("maps Graft-branded home names back to leftover upstream names", () => {
    expect(legacyHomeDirectoryName(".graft")).toBe(".synara");
    expect(legacyHomeDirectoryName(".graft-dev")).toBe(".synara-dev");
    expect(legacyHomeDirectoryName(".graft-canary")).toBe(".synara-canary");
    expect(legacyHomeDirectoryName(".custom")).toBe(".custom");
  });
});

describe("preferExistingPath", () => {
  it("keeps the Graft path when neither root exists yet", () => {
    const root = makeTempDir();
    const preferred = Path.join(root, "graft");
    const legacy = Path.join(root, "synara");
    expect(preferExistingPath(preferred, legacy)).toBe(preferred);
  });

  it("reuses an existing leftover root when the Graft root is absent", () => {
    const root = makeTempDir();
    const preferred = Path.join(root, "graft");
    const legacy = Path.join(root, "synara");
    FS.mkdirSync(legacy);
    expect(preferExistingPath(preferred, legacy)).toBe(legacy);
  });

  it("does not rewrite an existing Graft root even when a leftover root remains", () => {
    const root = makeTempDir();
    const preferred = Path.join(root, "graft");
    const legacy = Path.join(root, "synara");
    FS.mkdirSync(preferred);
    FS.mkdirSync(legacy);
    expect(preferExistingPath(preferred, legacy)).toBe(preferred);
  });
});

describe("resolveGraftHomeDirectory", () => {
  it("defaults new installs to ~/.graft", () => {
    expect(GRAFT_HOME_ENV_NAME).toBe("GRAFT_HOME");
    expect(DEFAULT_GRAFT_HOME_DIRECTORY_NAME).toBe(".graft");
    expect(LEGACY_HOME_DIRECTORY_NAME).toBe(".synara");
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
