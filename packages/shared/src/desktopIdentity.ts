// FILE: desktopIdentity.ts
// Purpose: Defines the canonical desktop application identity across packaging and runtime.

// Keep upstream export names stable; runtime identifiers belong exclusively to Graft.
export const GRAFT_PRODUCT_NAME = "Graft";

export const GRAFT_DESKTOP_SCHEME = "graft";
export const GRAFT_DESKTOP_ORIGIN = `${GRAFT_DESKTOP_SCHEME}://app`;
export const GRAFT_DESKTOP_ENTRY_URL = `${GRAFT_DESKTOP_ORIGIN}/index.html`;
// Stable replaces the installed legacy app through its existing updater feed.
// Storage remains separate so migration can preserve the original database.
export const GRAFT_DESKTOP_UPDATE_CHANNEL = "latest";
export const GRAFT_DESKTOP_UPDATE_URL =
  "https://xvce84ljzxgawnao.public.blob.vercel-storage.com/releases";
export const GRAFT_PRODUCTION_BUNDLE_ID = "com.graft.studio";
export const GRAFT_DEVELOPMENT_BUNDLE_ID = "com.graft.studio.next.dev";
export const GRAFT_CANARY_BUNDLE_ID = "com.graft.studio.next.canary";
export const GRAFT_CANARY_DESKTOP_SCHEME = "graft-canary";
export const GRAFT_CANARY_DESKTOP_ORIGIN = `${GRAFT_CANARY_DESKTOP_SCHEME}://app`;
export const GRAFT_CANARY_DESKTOP_ENTRY_URL = `${GRAFT_CANARY_DESKTOP_ORIGIN}/index.html`;
export const GRAFT_SOURCE_DESKTOP_BUILD_MARKER = "graft-source-desktop-build-v2";
export const GRAFT_DESKTOP_SMOKE_USER_DATA_ENV = "GRAFT_DESKTOP_SMOKE_USER_DATA";

export type GraftDesktopFlavor = "production" | "development" | "canary";

export interface GraftDesktopIdentity {
  readonly flavor: GraftDesktopFlavor;
  readonly displayName: string;
  readonly bundleId: string;
  readonly scheme: string;
  readonly origin: string;
  readonly entryUrl: string;
  readonly userDataDirectoryName: string;
  readonly defaultHomeDirectoryName: string;
  readonly usesScriptedUpdates: boolean;
}

export function resolveGraftDesktopFlavor(input: {
  readonly isDevelopment: boolean;
  readonly requestedFlavor?: string | undefined;
  readonly allowDevelopmentOverride?: boolean | undefined;
}): GraftDesktopFlavor {
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

export function graftDesktopIdentity(flavor: GraftDesktopFlavor): GraftDesktopIdentity {
  if (flavor === "canary") {
    return {
      flavor,
      displayName: `${GRAFT_PRODUCT_NAME} Canary`,
      bundleId: GRAFT_CANARY_BUNDLE_ID,
      scheme: GRAFT_CANARY_DESKTOP_SCHEME,
      origin: GRAFT_CANARY_DESKTOP_ORIGIN,
      entryUrl: GRAFT_CANARY_DESKTOP_ENTRY_URL,
      userDataDirectoryName: "graft-studio-next-canary",
      defaultHomeDirectoryName: ".graft-canary",
      usesScriptedUpdates: true,
    };
  }
  if (flavor === "development") {
    return {
      flavor,
      displayName: `${GRAFT_PRODUCT_NAME} (Dev)`,
      bundleId: GRAFT_DEVELOPMENT_BUNDLE_ID,
      scheme: GRAFT_DESKTOP_SCHEME,
      origin: GRAFT_DESKTOP_ORIGIN,
      entryUrl: GRAFT_DESKTOP_ENTRY_URL,
      userDataDirectoryName: "graft-studio-next-dev",
      defaultHomeDirectoryName: ".graft-dev",
      usesScriptedUpdates: false,
    };
  }
  return {
    flavor,
    displayName: GRAFT_PRODUCT_NAME,
    bundleId: GRAFT_PRODUCTION_BUNDLE_ID,
    scheme: GRAFT_DESKTOP_SCHEME,
    origin: GRAFT_DESKTOP_ORIGIN,
    entryUrl: GRAFT_DESKTOP_ENTRY_URL,
    userDataDirectoryName: "graft-studio-next",
    defaultHomeDirectoryName: ".graft",
    usesScriptedUpdates: false,
  };
}
