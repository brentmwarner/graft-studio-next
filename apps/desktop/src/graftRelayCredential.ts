import { join } from "node:path";

import { readRestrictedLegacyCredentialJson } from "./legacyCredentialFile";

export interface RelayCredentialStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  decryptString(value: Buffer): string;
}

/** Read only the legacy relay credential; leave the legacy store and session credentials intact. */
export function readLegacyGraftRelayCredential(options: {
  appData: string;
  safeStorage: RelayCredentialStorage;
  platform: NodeJS.Platform;
  legacyUserData?: string;
}): string | null {
  try {
    const userData = options.legacyUserData ?? join(options.appData, "@graft", "desktop");
    const envelope = readRestrictedLegacyCredentialJson(
      join(userData, "remote-gateway", "secrets.json"),
    );
    if (
      !envelope ||
      typeof envelope !== "object" ||
      !("version" in envelope) ||
      envelope.version !== 1 ||
      !("secrets" in envelope) ||
      !envelope.secrets ||
      typeof envelope.secrets !== "object" ||
      !("relay-uplink" in envelope.secrets) ||
      typeof envelope.secrets["relay-uplink"] !== "string"
    )
      return null;
    // Electron's safeStorage availability check can enter the native keychain
    // path on macOS. Avoid that work entirely for clean installs and profiles
    // without a relay credential to migrate.
    if (!options.safeStorage.isEncryptionAvailable()) return null;
    if (
      options.platform === "linux" &&
      ["basic_text", "unknown"].includes(
        options.safeStorage.getSelectedStorageBackend?.() ?? "unknown",
      )
    )
      return null;
    const serialized = options.safeStorage.decryptString(
      Buffer.from(envelope.secrets["relay-uplink"], "base64"),
    );
    // The backend validates the full credential before opening any connection.
    const parsed: unknown = JSON.parse(serialized);
    return parsed && typeof parsed === "object" ? serialized : null;
  } catch {
    return null;
  }
}
