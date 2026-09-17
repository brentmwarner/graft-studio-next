import { describe, expect, it } from "vitest";

import { resolveDesktopBackendExecutable } from "./desktopBackendExecutable";

describe("resolveDesktopBackendExecutable", () => {
  it("uses the primary packaged Helper on macOS", () => {
    expect(
      resolveDesktopBackendExecutable({
        appIsPackaged: true,
        execPath: "/Applications/Graft.app/Contents/MacOS/Graft",
        platform: "darwin",
      }),
    ).toBe(
      "/Applications/Graft.app/Contents/Frameworks/Graft Helper.app/Contents/MacOS/Graft Helper",
    );
  });

  it("keeps the current executable for development and other platforms", () => {
    expect(
      resolveDesktopBackendExecutable({
        appIsPackaged: false,
        execPath: "/Applications/Electron.app/Contents/MacOS/Electron",
        platform: "darwin",
      }),
    ).toBe("/Applications/Electron.app/Contents/MacOS/Electron");
    expect(
      resolveDesktopBackendExecutable({
        appIsPackaged: true,
        execPath: "C:\\Program Files\\Graft\\graft.exe",
        platform: "win32",
      }),
    ).toBe("C:\\Program Files\\Graft\\graft.exe");
  });
});
