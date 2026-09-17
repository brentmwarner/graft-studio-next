import { describe, expect, it } from "vitest";

import { resolveDesktopBackendEntry } from "./backendEntryPath";

describe("resolveDesktopBackendEntry", () => {
  it("uses the physical unpacked server bundle in packaged apps", () => {
    expect(
      resolveDesktopBackendEntry("/Applications/Graft.app/Contents/Resources/app.asar", true),
    ).toBe(
      "/Applications/Graft.app/Contents/Resources/app.asar.unpacked/apps/server/dist/index.mjs",
    );
  });

  it("uses the workspace server bundle during development", () => {
    expect(resolveDesktopBackendEntry("/workspace/graft", false)).toBe(
      "/workspace/graft/apps/server/dist/index.mjs",
    );
  });
});
