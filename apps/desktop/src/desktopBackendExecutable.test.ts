import { describe, expect, it } from "vitest";

import {
  resolveDesktopBackendEntry,
  resolveDesktopBackendExecutable,
} from "./desktopBackendExecutable";

describe("resolveDesktopBackendExecutable", () => {
  it("uses the bundled standalone Node runtime on packaged macOS", () => {
    expect(
      resolveDesktopBackendExecutable({
        appIsPackaged: true,
        execPath: "/Applications/Graft.app/Contents/MacOS/Graft",
        platform: "darwin",
        resourcesPath: "/Applications/Graft.app/Contents/Resources",
      }),
    ).toBe("/Applications/Graft.app/Contents/Resources/node-runtime/node");
  });

  it("keeps the current executable for development and other platforms", () => {
    expect(
      resolveDesktopBackendExecutable({
        appIsPackaged: false,
        execPath: "/Applications/Electron.app/Contents/MacOS/Electron",
        platform: "darwin",
        resourcesPath: "/Applications/Electron.app/Contents/Resources",
      }),
    ).toBe("/Applications/Electron.app/Contents/MacOS/Electron");
    expect(
      resolveDesktopBackendExecutable({
        appIsPackaged: true,
        execPath: "C:\\Program Files\\Graft\\graft.exe",
        platform: "win32",
        resourcesPath: "C:\\Program Files\\Graft\\resources",
      }),
    ).toBe("C:\\Program Files\\Graft\\graft.exe");
  });
});

describe("resolveDesktopBackendEntry", () => {
  it("uses the unpacked server graph with bundled Node on packaged macOS", () => {
    expect(
      resolveDesktopBackendEntry({
        appIsPackaged: true,
        appRoot: "/Applications/Graft.app/Contents/Resources/app.asar",
        platform: "darwin",
        resourcesPath: "/Applications/Graft.app/Contents/Resources",
      }),
    ).toBe(
      "/Applications/Graft.app/Contents/Resources/app.asar.unpacked/apps/server/dist/index.mjs",
    );
  });

  it("keeps the app-root entry on other launches", () => {
    expect(
      resolveDesktopBackendEntry({
        appIsPackaged: true,
        appRoot: "C:\\Program Files\\Graft\\resources\\app.asar",
        platform: "win32",
        resourcesPath: "C:\\Program Files\\Graft\\resources",
      }),
    ).toBe("C:\\Program Files\\Graft\\resources\\app.asar/apps/server/dist/index.mjs");
  });
});
