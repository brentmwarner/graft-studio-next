// FILE: release-workspace-manifests.ts
// Purpose: Single source for workspace importers copied into release verification/staging roots.
// Layer: Release/build helper

export const RELEASE_WORKSPACE_MANIFEST_PATHS = [
  "package.json",
  "apps/server/package.json",
  "apps/desktop/package.json",
  "apps/host/package.json",
  "apps/web/package.json",
  "apps/marketing/package.json",
  "apps/mobile-android/package.json",
  "packages/contracts/package.json",
  "packages/desktop-contract/package.json",
  "packages/graft-occupancy/package.json",
  "packages/mobile-contract/package.json",
  "packages/shared/package.json",
  "scripts/package.json",
] as const;

export const RELEASE_LOCKFILE_PATH = "bun.lock";
export const RELEASE_PATCHES_PATH = "patches";
