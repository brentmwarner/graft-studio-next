import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AccountEncryption } from "./graftAccountTokenStore";

const ACCOUNT_KEY = "graft-studio-account:jwt";
const MAX_LEGACY_BYTES = 2 * 1024 * 1024;

function readRestrictedJson(path: string): unknown {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > MAX_LEGACY_BYTES)
    throw new Error("Invalid legacy credential file.");
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Import only the account entry; never rewrite the legacy store or decode plaintext envelopes. */
export function readLegacyGraftAccountToken(
  userData: string,
  encryption: AccountEncryption,
): string | null {
  try {
    const journalPath = join(userData, "credential-deletions.json");
    let journal: unknown;
    try {
      journal = readRestrictedJson(journalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
    }
    if (journal !== undefined) {
      if (
        !journal ||
        typeof journal !== "object" ||
        !("version" in journal) ||
        (journal.version !== 1 && journal.version !== 2) ||
        !("pendingDeletes" in journal) ||
        !Array.isArray(journal.pendingDeletes) ||
        journal.pendingDeletes.length > 10_000 ||
        !journal.pendingDeletes.every((key) => typeof key === "string" && key.length > 0) ||
        journal.pendingDeletes.includes(ACCOUNT_KEY) ||
        !("disconnectedProviders" in journal) ||
        !Array.isArray(journal.disconnectedProviders)
      )
        return null;
      const keys =
        journal.version === 1
          ? ["version", "pendingDeletes", "disconnectedProviders"]
          : ["version", "pendingDeletes", "disconnectedProviders", "disconnectedInstanceIds"];
      if (
        Object.keys(journal).length !== keys.length ||
        Object.keys(journal).some((key) => !keys.includes(key)) ||
        (journal.version === 2 &&
          (!("disconnectedInstanceIds" in journal) ||
            !Array.isArray(journal.disconnectedInstanceIds)))
      )
        return null;
    }
    const envelope = readRestrictedJson(join(userData, "encrypted-credentials.json"));
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return null;
    const data =
      "data" in envelope
        ? "encrypted" in envelope && envelope.encrypted === true
          ? envelope.data
          : null
        : envelope;
    if (
      !data ||
      typeof data !== "object" ||
      !(ACCOUNT_KEY in data) ||
      typeof data[ACCOUNT_KEY] !== "string"
    )
      return null;
    if (
      !encryption.isEncryptionAvailable() ||
      ["basic_text", "unknown"].includes(encryption.getSelectedStorageBackend?.() ?? "")
    )
      return null;
    const encoded = data[ACCOUNT_KEY];
    if (encoded.length > 48 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
    const token = encryption.decryptString(Buffer.from(encoded, "base64"));
    return token.length > 0 && Buffer.byteLength(token) <= 16 * 1024 ? token : null;
  } catch {
    // Missing, locked or incompatible legacy credentials lead to normal browser sign-in.
    return null;
  }
}
