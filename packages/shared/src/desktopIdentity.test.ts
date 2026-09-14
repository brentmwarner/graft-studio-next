import { describe, expect, it } from "vitest";

import {
  resolveSynaraDesktopFlavor,
  SYNARA_CANARY_BUNDLE_ID,
  SYNARA_CANARY_DESKTOP_ENTRY_URL,
  SYNARA_CANARY_DESKTOP_ORIGIN,
  SYNARA_DESKTOP_ENTRY_URL,
  SYNARA_DESKTOP_ORIGIN,
  SYNARA_DESKTOP_UPDATE_CHANNEL,
  SYNARA_DEVELOPMENT_BUNDLE_ID,
  SYNARA_PRODUCTION_BUNDLE_ID,
  synaraDesktopIdentity,
} from "./desktopIdentity";

describe("desktopIdentity", () => {
  it("keeps every Graft profile separate from Synara and legacy Graft", () => {
    const profiles = (["production", "development", "canary"] as const).map((flavor) =>
      synaraDesktopIdentity(flavor),
    );
    expect(profiles.map((identity) => identity.userDataDirectoryName)).toEqual([
      "graft-studio-next",
      "graft-studio-next-dev",
      "graft-studio-next-canary",
    ]);
    expect(new Set(profiles.map((identity) => identity.bundleId)).size).toBe(3);
    for (const identity of profiles) {
      expect(identity.bundleId).not.toMatch(/^com\.emanueledipietro\.synara/);
      expect(identity.bundleId).not.toBe("com.graft.studio");
      expect(identity.scheme).not.toMatch(/^synara/);
    }
  });

  it("uses the exact canonical production and development bundle IDs", () => {
    expect(SYNARA_PRODUCTION_BUNDLE_ID).toBe("com.graft.studio.next");
    expect(SYNARA_DEVELOPMENT_BUNDLE_ID).toBe("com.graft.studio.next.dev");
    expect(synaraDesktopIdentity("production").bundleId).toBe(SYNARA_PRODUCTION_BUNDLE_ID);
    expect(synaraDesktopIdentity("development").bundleId).toBe(SYNARA_DEVELOPMENT_BUNDLE_ID);
  });

  it("uses the exact packaged renderer origin and entry URL", () => {
    expect(SYNARA_DESKTOP_ORIGIN).toBe("graft://app");
    expect(SYNARA_DESKTOP_ENTRY_URL).toBe("graft://app/index.html");
  });

  it("uses the isolated Graft desktop update channel", () => {
    expect(SYNARA_DESKTOP_UPDATE_CHANNEL).toBe("graft");
  });

  it("gives Canary a fully separate desktop identity and storage profile", () => {
    expect(SYNARA_CANARY_BUNDLE_ID).toBe("com.graft.studio.next.canary");
    expect(SYNARA_CANARY_DESKTOP_ORIGIN).toBe("graft-canary://app");
    expect(SYNARA_CANARY_DESKTOP_ENTRY_URL).toBe("graft-canary://app/index.html");
    expect(synaraDesktopIdentity("canary")).toEqual({
      flavor: "canary",
      displayName: "Graft Canary",
      bundleId: SYNARA_CANARY_BUNDLE_ID,
      scheme: "graft-canary",
      origin: SYNARA_CANARY_DESKTOP_ORIGIN,
      entryUrl: SYNARA_CANARY_DESKTOP_ENTRY_URL,
      userDataDirectoryName: "graft-studio-next-canary",
      defaultHomeDirectoryName: ".graft-canary",
      usesScriptedUpdates: true,
    });
  });

  it("selects explicit source flavors without changing packaged Stable", () => {
    expect(resolveSynaraDesktopFlavor({ isDevelopment: false })).toBe("production");
    expect(resolveSynaraDesktopFlavor({ isDevelopment: true })).toBe("development");
    expect(
      resolveSynaraDesktopFlavor({ isDevelopment: false, requestedFlavor: "development" }),
    ).toBe("production");
    expect(
      resolveSynaraDesktopFlavor({
        isDevelopment: false,
        requestedFlavor: "development",
        allowDevelopmentOverride: true,
      }),
    ).toBe("development");
    expect(resolveSynaraDesktopFlavor({ isDevelopment: false, requestedFlavor: " canary " })).toBe(
      "canary",
    );
    expect(resolveSynaraDesktopFlavor({ isDevelopment: true, requestedFlavor: "canary" })).toBe(
      "canary",
    );
  });

  it("isolates development and Canary homes from packaged Stable", () => {
    expect(synaraDesktopIdentity("development").defaultHomeDirectoryName).toBe(".graft-dev");
    expect(synaraDesktopIdentity("canary").defaultHomeDirectoryName).toBe(".graft-canary");
    expect(synaraDesktopIdentity("production").defaultHomeDirectoryName).toBe(".graft");
  });
});
