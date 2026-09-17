import { lstatSync, readFileSync } from "node:fs";

const MAX_LEGACY_CREDENTIAL_FILE_BYTES = 2 * 1024 * 1024;

export function readRestrictedLegacyCredentialJson(path: string): unknown {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > MAX_LEGACY_CREDENTIAL_FILE_BYTES) {
    throw new Error("Invalid legacy credential file.");
  }
  return JSON.parse(readFileSync(path, "utf8"));
}
