import { describe, expect, it } from "vitest";

import {
  resolveGraftDesktopFlavor,
  GRAFT_CANARY_BUNDLE_ID,
  GRAFT_CANARY_DESKTOP_ENTRY_URL,
  GRAFT_CANARY_DESKTOP_ORIGIN,
  GRAFT_DESKTOP_ENTRY_URL,
  GRAFT_DESKTOP_ORIGIN,
  GRAFT_DESKTOP_UPDATE_CHANNEL,
  GRAFT_DESKTOP_UPDATE_GITHUB_OWNER,
  GRAFT_DESKTOP_UPDATE_GITHUB_RELEASES_URL,
  GRAFT_DESKTOP_UPDATE_GITHUB_REPOSITORY,
  GRAFT_DESKTOP_UPDATE_URL,
  GRAFT_DEVELOPMENT_BUNDLE_ID,
  GRAFT_PRODUCTION_BUNDLE_ID,
  graftDesktopIdentity,
} from "./desktopIdentity";

describe("desktopIdentity", () => {
  it("keeps every Graft profile separate from leftover Synara and legacy Graft", () => {
    const profiles = (["production", "development", "canary"] as const).map((flavor) =>
      graftDesktopIdentity(flavor),
    );
    expect(profiles.map((identity) => identity.userDataDirectoryName)).toEqual([
      "graft-studio-next",
      "graft-studio-next-dev",
      "graft-studio-next-canary",
    ]);
    expect(new Set(profiles.map((identity) => identity.bundleId)).size).toBe(3);
    for (const identity of profiles) {
      expect(identity.bundleId).not.toMatch(/^com\.emanueledipietro\.synara/);
      expect(identity.scheme).not.toMatch(/^synara/);
    }
  });

  it("uses the exact canonical production and development bundle IDs", () => {
    expect(GRAFT_PRODUCTION_BUNDLE_ID).toBe("com.graft.studio");
    expect(GRAFT_DEVELOPMENT_BUNDLE_ID).toBe("com.graft.studio.next.dev");
    expect(graftDesktopIdentity("production").bundleId).toBe(GRAFT_PRODUCTION_BUNDLE_ID);
    expect(graftDesktopIdentity("development").bundleId).toBe(GRAFT_DEVELOPMENT_BUNDLE_ID);
  });

  it("uses the exact packaged renderer origin and entry URL", () => {
    expect(GRAFT_DESKTOP_ORIGIN).toBe("graft://app");
    expect(GRAFT_DESKTOP_ENTRY_URL).toBe("graft://app/index.html");
  });

  it("keeps the legacy bridge and pins new builds to the public GitHub updater", () => {
    expect(GRAFT_DESKTOP_UPDATE_CHANNEL).toBe("latest");
    expect(GRAFT_DESKTOP_UPDATE_URL).toBe(
      "https://xvce84ljzxgawnao.public.blob.vercel-storage.com/releases",
    );
    expect(GRAFT_DESKTOP_UPDATE_GITHUB_OWNER).toBe("brentmwarner");
    expect(GRAFT_DESKTOP_UPDATE_GITHUB_REPOSITORY).toBe("graft-studio-next");
    expect(GRAFT_DESKTOP_UPDATE_GITHUB_RELEASES_URL).toBe(
      "https://github.com/brentmwarner/graft-studio-next/releases",
    );
  });

  it("gives Canary a fully separate desktop identity and storage profile", () => {
    expect(GRAFT_CANARY_BUNDLE_ID).toBe("com.graft.studio.next.canary");
    expect(GRAFT_CANARY_DESKTOP_ORIGIN).toBe("graft-canary://app");
    expect(GRAFT_CANARY_DESKTOP_ENTRY_URL).toBe("graft-canary://app/index.html");
    expect(graftDesktopIdentity("canary")).toEqual({
      flavor: "canary",
      displayName: "Graft Canary",
      bundleId: GRAFT_CANARY_BUNDLE_ID,
      scheme: "graft-canary",
      origin: GRAFT_CANARY_DESKTOP_ORIGIN,
      entryUrl: GRAFT_CANARY_DESKTOP_ENTRY_URL,
      userDataDirectoryName: "graft-studio-next-canary",
      defaultHomeDirectoryName: ".graft-canary",
      usesScriptedUpdates: true,
    });
  });

  it("selects explicit source flavors without changing packaged Stable", () => {
    expect(resolveGraftDesktopFlavor({ isDevelopment: false })).toBe("production");
    expect(resolveGraftDesktopFlavor({ isDevelopment: true })).toBe("development");
    expect(
      resolveGraftDesktopFlavor({ isDevelopment: false, requestedFlavor: "development" }),
    ).toBe("production");
    expect(
      resolveGraftDesktopFlavor({
        isDevelopment: false,
        requestedFlavor: "development",
        allowDevelopmentOverride: true,
      }),
    ).toBe("development");
    expect(resolveGraftDesktopFlavor({ isDevelopment: false, requestedFlavor: " canary " })).toBe(
      "canary",
    );
    expect(resolveGraftDesktopFlavor({ isDevelopment: true, requestedFlavor: "canary" })).toBe(
      "canary",
    );
  });

  it("isolates development and Canary homes from packaged Stable", () => {
    expect(graftDesktopIdentity("development").defaultHomeDirectoryName).toBe(".graft-dev");
    expect(graftDesktopIdentity("canary").defaultHomeDirectoryName).toBe(".graft-canary");
    expect(graftDesktopIdentity("production").defaultHomeDirectoryName).toBe(".graft");
  });
});
