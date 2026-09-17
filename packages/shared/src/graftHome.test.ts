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
  resolveUserHomeDirectory,
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

  it("does not query the OS home for an absolute configured path", () => {
    expect(
      resolveGraftHomeDirectory({
        configuredHome: "/tmp/isolated-graft",
        env: {},
        readHomeDirectory: () => {
          throw new Error("OS home lookup must stay lazy");
        },
      }),
    ).toBe(Path.resolve("/tmp/isolated-graft"));
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

describe("resolveUserHomeDirectory", () => {
  it("prefers inherited POSIX and Windows home values without querying the OS", () => {
    const readHomeDirectory = () => {
      throw new Error("OS home lookup must stay lazy");
    };

    expect(
      resolveUserHomeDirectory({
        env: { HOME: "/users/posix" },
        platform: "darwin",
        readHomeDirectory,
      }),
    ).toBe(Path.resolve("/users/posix"));
    expect(
      resolveUserHomeDirectory({
        env: { HOME: "C:\\fallback", USERPROFILE: "C:\\Users\\tester" },
        platform: "win32",
        readHomeDirectory,
      }),
    ).toBe(Path.win32.resolve("C:\\Users\\tester"));
  });
});
