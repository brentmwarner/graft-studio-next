import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SYNARA_HOME_DIRECTORY_NAME,
  LEGACY_SYNARA_HOME_DIRECTORY_NAME,
  expandHomePath,
  isAppHomeDirectoryName,
  legacySynaraHomeDirectoryName,
  preferExistingPath,
  resolveSynaraHomeDirectory,
} from "./synaraHome";

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
  it("recognizes Graft and Synara homes, including flavor suffixes", () => {
    expect(isAppHomeDirectoryName(".graft")).toBe(true);
    expect(isAppHomeDirectoryName(".synara")).toBe(true);
    expect(isAppHomeDirectoryName(".graft-dev")).toBe(true);
    expect(isAppHomeDirectoryName(".synara-canary")).toBe(true);
    expect(isAppHomeDirectoryName(".cursor")).toBe(false);
    expect(isAppHomeDirectoryName("graft")).toBe(false);
  });
});

describe("legacySynaraHomeDirectoryName", () => {
  it("maps Graft-branded home names back to Synara names", () => {
    expect(legacySynaraHomeDirectoryName(".graft")).toBe(".synara");
    expect(legacySynaraHomeDirectoryName(".graft-dev")).toBe(".synara-dev");
    expect(legacySynaraHomeDirectoryName(".graft-canary")).toBe(".synara-canary");
    expect(legacySynaraHomeDirectoryName(".custom")).toBe(".custom");
  });
});

describe("preferExistingPath", () => {
  it("keeps the Graft path when neither root exists yet", () => {
    const root = makeTempDir();
    const preferred = Path.join(root, "graft");
    const legacy = Path.join(root, "synara");
    expect(preferExistingPath(preferred, legacy)).toBe(preferred);
  });

  it("reuses an existing Synara root when the Graft root is absent", () => {
    const root = makeTempDir();
    const preferred = Path.join(root, "graft");
    const legacy = Path.join(root, "synara");
    FS.mkdirSync(legacy);
    expect(preferExistingPath(preferred, legacy)).toBe(legacy);
  });

  it("does not rewrite an existing Graft root even when a Synara root remains", () => {
    const root = makeTempDir();
    const preferred = Path.join(root, "graft");
    const legacy = Path.join(root, "synara");
    FS.mkdirSync(preferred);
    FS.mkdirSync(legacy);
    expect(preferExistingPath(preferred, legacy)).toBe(preferred);
  });
});

describe("resolveSynaraHomeDirectory", () => {
  it("prefers an explicit Graft environment over inherited Synara configuration", () => {
    expect(
      resolveSynaraHomeDirectory({
        env: { GRAFT_HOME: "/tmp/graft", SYNARA_HOME: "/tmp/synara" },
      }),
    ).toBe(Path.resolve("/tmp/graft"));
  });

  it("defaults new installs to ~/.graft", () => {
    expect(DEFAULT_SYNARA_HOME_DIRECTORY_NAME).toBe(".graft");
    expect(LEGACY_SYNARA_HOME_DIRECTORY_NAME).toBe(".synara");
    expect(resolveSynaraHomeDirectory({ env: {}, homeDirectory: "/users/tester" })).toBe(
      Path.join("/users/tester", ".graft"),
    );
  });

  it("honors SYNARA_HOME and explicit configuredHome", () => {
    expect(
      resolveSynaraHomeDirectory({
        env: { SYNARA_HOME: "/tmp/custom-synara" },
        homeDirectory: "/users/tester",
      }),
    ).toBe(Path.resolve("/tmp/custom-synara"));
    expect(
      resolveSynaraHomeDirectory({
        configuredHome: "~/Documents/Graft",
        env: { SYNARA_HOME: "/tmp/ignored" },
        homeDirectory: "/users/tester",
      }),
    ).toBe(Path.join("/users/tester", "Documents", "Graft"));
    expect(
      resolveSynaraHomeDirectory({
        configuredHome: "   ",
        env: { SYNARA_HOME: "/tmp/custom-synara" },
        homeDirectory: "/users/tester",
      }),
    ).toBe(Path.resolve("/tmp/custom-synara"));
  });

  it("does not select Synara storage when the Graft root is absent", () => {
    const homeDirectory = makeTempDir();
    FS.mkdirSync(Path.join(homeDirectory, ".synara"));
    expect(resolveSynaraHomeDirectory({ env: {}, homeDirectory })).toBe(
      Path.join(homeDirectory, ".graft"),
    );
  });

  it("keeps development storage separate from an existing Synara home", () => {
    const homeDirectory = makeTempDir();
    FS.mkdirSync(Path.join(homeDirectory, ".synara-dev"));
    expect(
      resolveSynaraHomeDirectory({
        env: {},
        homeDirectory,
        directoryName: ".graft-dev",
      }),
    ).toBe(Path.join(homeDirectory, ".graft-dev"));
  });
});
