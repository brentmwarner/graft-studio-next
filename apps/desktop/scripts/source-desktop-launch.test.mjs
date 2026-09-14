import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  SYNARA_DESKTOP_SMOKE_USER_DATA_ENV,
  SYNARA_SOURCE_DESKTOP_BUILD_MARKER,
} from "@synara/shared/desktopIdentity";
import { spawnSourceDesktop } from "./source-desktop-launch.mjs";

function captureSourceDesktopSpawn(environment, overrides = {}) {
  const child = { on: vi.fn() };
  const spawnProcess = vi.fn(() => child);

  const result = spawnSourceDesktop({
    desktopDirectory: "/workspace/apps/desktop",
    electronPath: "/runtime/electron",
    environment,
    homeDirectory: "/Users/tester",
    platform: "darwin",
    readBuiltMain: () => SYNARA_SOURCE_DESKTOP_BUILD_MARKER,
    spawnProcess,
    ...overrides,
  });

  return { child, result, spawnProcess };
}

describe("source desktop launch", () => {
  it("does not adopt an inherited Synara home as Graft's profile", () => {
    const { spawnProcess } = captureSourceDesktopSpawn({ SYNARA_HOME: "/upstream/synara" });
    expect(spawnProcess.mock.calls[0][2].env.GRAFT_HOME).toBe(
      join("/Users/tester", ".graft-dev"),
    );
  });

  it("launches normal macOS starts through LaunchServices without secrets in argv", () => {
    const { spawnProcess } = captureSourceDesktopSpawn(
      {
        GRAFT_HOME: "/tmp/isolated",
        SYNARA_AUTH_TOKEN: "synthetic-secret",
        ELECTRON_RUN_AS_NODE: "1",
      },
      { electronPath: "/runtime/Synara (Dev).app/Contents/MacOS/Electron", launchViaMacOS: true },
    );
    expect(spawnProcess).toHaveBeenCalledWith(
      "/usr/bin/open",
      [
        "-W",
        "-n",
        "-a",
        "/runtime/Synara (Dev).app",
        "--args",
        "/workspace/apps/desktop/dist-electron/main.js",
      ],
      expect.objectContaining({
        env: expect.objectContaining({
          GRAFT_HOME: "/tmp/isolated",
          SYNARA_AUTH_TOKEN: "synthetic-secret",
        }),
      }),
    );
    expect(spawnProcess.mock.calls[0][2].env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    expect(JSON.stringify(spawnProcess.mock.calls[0][1])).not.toContain("synthetic-secret");
  });

  it.each([
    { platform: "linux", electronPath: "/runtime/Synara.app/Contents/MacOS/Electron" },
    { platform: "darwin", electronPath: "/runtime/electron" },
  ])("rejects an invalid LaunchServices target before spawning", (overrides) => {
    expect(() => captureSourceDesktopSpawn({}, { ...overrides, launchViaMacOS: true })).toThrow(
      "macOS application bundle",
    );
  });

  it("spawns current source builds with an isolated development environment", () => {
    const environment = {
      ELECTRON_RUN_AS_NODE: "1",
      PATH: "/usr/bin",
    };

    const { child, result, spawnProcess } = captureSourceDesktopSpawn(environment);

    expect(result).toBe(child);
    expect(spawnProcess).toHaveBeenCalledWith("/runtime/electron", ["dist-electron/main.js"], {
      cwd: "/workspace/apps/desktop",
      env: {
        PATH: "/usr/bin",
        SYNARA_DESKTOP_FLAVOR: "development",
        GRAFT_HOME: join("/Users/tester", ".graft-dev"),
        SYNARA_SOURCE_DESKTOP_BUILD_MARKER,
      },
      stdio: "inherit",
    });
    expect(environment).toEqual({
      ELECTRON_RUN_AS_NODE: "1",
      PATH: "/usr/bin",
    });
  });

  it("preserves an explicit Graft home", () => {
    const readWindowsEnvironment = vi.fn(() => ({
      GRAFT_HOME: "C:\\Users\\tester\\persisted-synara-home",
    }));
    const { spawnProcess } = captureSourceDesktopSpawn(
      { GRAFT_HOME: "/tmp/custom-synara-home" },
      { platform: "win32", readWindowsEnvironment },
    );

    expect(spawnProcess.mock.calls[0][2].env).toMatchObject({
      SYNARA_DESKTOP_FLAVOR: "development",
      GRAFT_HOME: "/tmp/custom-synara-home",
    });
    expect(readWindowsEnvironment).not.toHaveBeenCalled();
  });

  it("preserves a persisted Windows Graft home", () => {
    const { spawnProcess } = captureSourceDesktopSpawn(
      {},
      {
        platform: "win32",
        readWindowsEnvironment: () => ({
          Graft_Home: "C:\\Users\\tester\\persisted-synara-home",
        }),
      },
    );

    expect(spawnProcess.mock.calls[0][2].env.GRAFT_HOME).toBe(
      "C:\\Users\\tester\\persisted-synara-home",
    );
  });

  it("preserves Canary flavor and storage defaults", () => {
    const { spawnProcess } = captureSourceDesktopSpawn({
      SYNARA_DESKTOP_FLAVOR: "canary",
    });

    expect(spawnProcess.mock.calls[0][2].env).toMatchObject({
      SYNARA_DESKTOP_FLAVOR: "canary",
      GRAFT_HOME: join("/Users/tester", ".graft-canary"),
    });
  });

  it("guards and spawns the smoke desktop with its isolated environment", () => {
    const smokeHome = "/tmp/synara-desktop-smoke";
    const smokeUserData = join(smokeHome, "electron-user-data");
    const stdio = ["pipe", "pipe", "pipe"];
    const { spawnProcess } = captureSourceDesktopSpawn(
      {
        GRAFT_HOME: smokeHome,
        [SYNARA_DESKTOP_SMOKE_USER_DATA_ENV]: smokeUserData,
      },
      { stdio },
    );

    expect(spawnProcess.mock.calls[0][2].env).toMatchObject({
      GRAFT_HOME: smokeHome,
      [SYNARA_DESKTOP_SMOKE_USER_DATA_ENV]: smokeUserData,
    });
    expect(spawnProcess.mock.calls[0][2].stdio).toBe(stdio);
  });

  it("rejects stale built desktop output before spawning Electron", () => {
    const spawnProcess = vi.fn();

    expect(() =>
      spawnSourceDesktop({
        desktopDirectory: "/workspace/apps/desktop",
        electronPath: "/runtime/electron",
        environment: {},
        homeDirectory: "/Users/tester",
        platform: "darwin",
        readBuiltMain: () => "stale desktop output",
        spawnProcess,
      }),
    ).toThrow(/desktop build is stale/i);
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
