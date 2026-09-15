import { readFileSync } from "node:fs";
import { join } from "node:path";

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
    if (!options.safeStorage.isEncryptionAvailable()) return null;
    if (
      options.platform === "linux" &&
      ["basic_text", "unknown"].includes(
        options.safeStorage.getSelectedStorageBackend?.() ?? "unknown",
      )
    )
      return null;
    const userData = options.legacyUserData ?? join(options.appData, "@graft", "desktop");
    const envelope: unknown = JSON.parse(
      readFileSync(join(userData, "remote-gateway", "secrets.json"), "utf8"),
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
