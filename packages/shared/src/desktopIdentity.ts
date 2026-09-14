// FILE: desktopIdentity.ts
// Purpose: Defines the canonical desktop application identity across packaging and runtime.

// Keep upstream export names stable; runtime identifiers belong exclusively to Graft.
export const GRAFT_PRODUCT_NAME = "Graft";

export const SYNARA_DESKTOP_SCHEME = "graft";
export const SYNARA_DESKTOP_ORIGIN = `${SYNARA_DESKTOP_SCHEME}://app`;
export const SYNARA_DESKTOP_ENTRY_URL = `${SYNARA_DESKTOP_ORIGIN}/index.html`;
export const SYNARA_DESKTOP_UPDATE_CHANNEL = "graft";
export const SYNARA_PRODUCTION_BUNDLE_ID = "com.graft.studio.next";
export const SYNARA_DEVELOPMENT_BUNDLE_ID = `${SYNARA_PRODUCTION_BUNDLE_ID}.dev`;
export const SYNARA_CANARY_BUNDLE_ID = `${SYNARA_PRODUCTION_BUNDLE_ID}.canary`;
export const SYNARA_CANARY_DESKTOP_SCHEME = "graft-canary";
export const SYNARA_CANARY_DESKTOP_ORIGIN = `${SYNARA_CANARY_DESKTOP_SCHEME}://app`;
export const SYNARA_CANARY_DESKTOP_ENTRY_URL = `${SYNARA_CANARY_DESKTOP_ORIGIN}/index.html`;
export const SYNARA_SOURCE_DESKTOP_BUILD_MARKER = "synara-source-desktop-build-v2";
export const SYNARA_DESKTOP_SMOKE_USER_DATA_ENV = "SYNARA_DESKTOP_SMOKE_USER_DATA";

export type SynaraDesktopFlavor = "production" | "development" | "canary";

export interface SynaraDesktopIdentity {
  readonly flavor: SynaraDesktopFlavor;
  readonly displayName: string;
  readonly bundleId: string;
  readonly scheme: string;
  readonly origin: string;
  readonly entryUrl: string;
  readonly userDataDirectoryName: string;
  readonly defaultHomeDirectoryName: string;
  readonly usesScriptedUpdates: boolean;
}

export function resolveSynaraDesktopFlavor(input: {
  readonly isDevelopment: boolean;
  readonly requestedFlavor?: string | undefined;
  readonly allowDevelopmentOverride?: boolean | undefined;
}): SynaraDesktopFlavor {
  const requestedFlavor = input.requestedFlavor?.trim().toLowerCase();
  if (requestedFlavor === "canary") {
    return "canary";
  }
  if (
    requestedFlavor === "development" &&
    (input.isDevelopment || input.allowDevelopmentOverride === true)
  ) {
    return "development";
  }
  return input.isDevelopment ? "development" : "production";
}

export function synaraDesktopIdentity(flavor: SynaraDesktopFlavor): SynaraDesktopIdentity {
  if (flavor === "canary") {
    return {
      flavor,
      displayName: `${GRAFT_PRODUCT_NAME} Canary`,
      bundleId: SYNARA_CANARY_BUNDLE_ID,
      scheme: SYNARA_CANARY_DESKTOP_SCHEME,
      origin: SYNARA_CANARY_DESKTOP_ORIGIN,
      entryUrl: SYNARA_CANARY_DESKTOP_ENTRY_URL,
      userDataDirectoryName: "graft-studio-next-canary",
      defaultHomeDirectoryName: ".graft-canary",
      usesScriptedUpdates: true,
    };
  }
  if (flavor === "development") {
    return {
      flavor,
      displayName: `${GRAFT_PRODUCT_NAME} (Dev)`,
      bundleId: SYNARA_DEVELOPMENT_BUNDLE_ID,
      scheme: SYNARA_DESKTOP_SCHEME,
      origin: SYNARA_DESKTOP_ORIGIN,
      entryUrl: SYNARA_DESKTOP_ENTRY_URL,
      userDataDirectoryName: "graft-studio-next-dev",
      defaultHomeDirectoryName: ".graft-dev",
      usesScriptedUpdates: false,
    };
  }
  return {
    flavor,
    displayName: GRAFT_PRODUCT_NAME,
    bundleId: SYNARA_PRODUCTION_BUNDLE_ID,
    scheme: SYNARA_DESKTOP_SCHEME,
    origin: SYNARA_DESKTOP_ORIGIN,
    entryUrl: SYNARA_DESKTOP_ENTRY_URL,
    userDataDirectoryName: "graft-studio-next",
    defaultHomeDirectoryName: ".graft",
    usesScriptedUpdates: false,
  };
}
