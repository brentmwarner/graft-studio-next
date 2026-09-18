#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { writeReleaseArtifactProvenance } from "./lib/release-artifact-provenance.ts";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Native release build requires ${name}.`);
  return value;
}
const platform = required("PLATFORM");
if (platform !== "mac" && platform !== "win" && platform !== "linux")
  throw new Error("Unsupported native platform.");
const version = required("RELEASE_VERSION");
const sourceCommit = required("SOURCE_COMMIT");
const lockfileSha256 = required("LOCKFILE_SHA256");
const arch = required("ARCH");
const target = required("TARGET");
if (process.env.SIGN_ARTIFACTS !== "true" && process.env.SIGN_ARTIFACTS !== "false")
  throw new Error("SIGN_ARTIFACTS must be true or false.");
const signed = process.env.SIGN_ARTIFACTS === "true" && platform !== "linux";
const allowUnsignedWindowsPublication =
  process.env.ALLOW_UNSIGNED_WINDOWS_PUBLICATION === "true";
if (
  process.env.ALLOW_UNSIGNED_WINDOWS_PUBLICATION !== undefined &&
  process.env.ALLOW_UNSIGNED_WINDOWS_PUBLICATION !== "true" &&
  process.env.ALLOW_UNSIGNED_WINDOWS_PUBLICATION !== "false"
) {
  throw new Error("ALLOW_UNSIGNED_WINDOWS_PUBLICATION must be true or false when set.");
}
if (allowUnsignedWindowsPublication && (platform !== "win" || signed)) {
  throw new Error(
    "ALLOW_UNSIGNED_WINDOWS_PUBLICATION is valid only for an unsigned Windows build.",
  );
}
if (signed) {
  const credentials =
    platform === "mac"
      ? ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]
      : [
          "AZURE_TENANT_ID",
          "AZURE_CLIENT_ID",
          "AZURE_CLIENT_SECRET",
          "AZURE_TRUSTED_SIGNING_ENDPOINT",
          "AZURE_TRUSTED_SIGNING_ACCOUNT_NAME",
          "AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME",
          "AZURE_TRUSTED_SIGNING_PUBLISHER_NAME",
          "AZURE_TRUSTED_SIGNING_SUBJECT_DN",
        ];
  for (const name of credentials) required(name);
}
const args = [
  "scripts/build-desktop-artifact.ts",
  "--platform",
  platform,
  "--arch",
  arch,
  "--target",
  target,
  "--build-version",
  version,
  "--source-commit",
  sourceCommit,
  "--lockfile-sha256",
  lockfileSha256,
  "--verbose",
];
if (signed) args.push("--signed");
const result = spawnSync(process.execPath, args, { stdio: "inherit", shell: false });
if (result.error || result.status !== 0)
  throw new Error(`Native build failed: ${result.error?.message ?? result.status}.`);
mkdirSync("release-publish", { recursive: true });
for (const name of readdirSync("release")) {
  if (/\.(dmg|zip|exe|AppImage|blockmap)$/.test(name) || /^latest.*\.yml$/.test(name)) {
    copyFileSync(join("release", name), join("release-publish", name));
  }
}
await writeReleaseArtifactProvenance({
  assetsDirectory: "release-publish",
  platform,
  arch,
  target,
  version,
  sourceCommit,
  sourceTag: null,
  lockfileSha256,
  publication: false,
  signed,
  allowUnsignedWindowsPublication,
  ...(process.env.APPLE_TEAM_ID ? { expectedMacTeamId: process.env.APPLE_TEAM_ID } : {}),
  ...(process.env.AZURE_TRUSTED_SIGNING_PUBLISHER_NAME
    ? { expectedWindowsPublisher: process.env.AZURE_TRUSTED_SIGNING_PUBLISHER_NAME }
    : {}),
  ...(process.env.AZURE_TRUSTED_SIGNING_SUBJECT_DN
    ? { expectedWindowsSubjectDn: process.env.AZURE_TRUSTED_SIGNING_SUBJECT_DN }
    : {}),
});
