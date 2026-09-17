import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";

import type { GraftAccountIdentity } from "@graft/contracts";

export interface VerifiedGraftAccount {
  readonly account: GraftAccountIdentity;
  readonly expiresAt: number;
}

export interface GraftAccountTokenStore {
  assertAvailable(): void;
  read(): string | null;
  readVerifiedAccount?(token: string): VerifiedGraftAccount | null;
  write(token: string, verified?: VerifiedGraftAccount): void;
  clear(): void;
}

export interface AccountEncryption {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class AccountStorageUnavailable extends Error {
  constructor() {
    super("Secure account storage is unavailable. Unlock your system keyring and try again.");
  }
}

const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_CIPHERTEXT_BYTES = 32 * 1024;

/** The optional legacy reader is read-only. Only verified sessions are written to this profile. */
export function createGraftAccountTokenStore(
  profilePath: string,
  encryption: AccountEncryption,
  readLegacyToken?: () => string | null,
): GraftAccountTokenStore {
  const filePath = Path.join(profilePath, "graft-account.enc");
  const importMarker = Path.join(profilePath, "graft-account-imported");
  const logoutMarker = Path.join(profilePath, "graft-account-signed-out");
  let suppressed = false;
  const assertAvailable = () => {
    if (
      !encryption.isEncryptionAvailable() ||
      ["basic_text", "unknown"].includes(encryption.getSelectedStorageBackend?.() ?? "")
    ) {
      throw new AccountStorageUnavailable();
    }
  };
  const mark = (marker: string) => {
    FS.mkdirSync(profilePath, { recursive: true, mode: 0o700 });
    let descriptor: number;
    try {
      descriptor = FS.openSync(marker, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !FS.lstatSync(marker).isFile())
        throw error;
      return;
    }
    try {
      FS.writeFileSync(descriptor, "1\n");
      FS.fsyncSync(descriptor);
    } finally {
      FS.closeSync(descriptor);
    }
  };
  const readSaved = (): { token: string; verified?: VerifiedGraftAccount } | null => {
    try {
      const stat = FS.lstatSync(filePath);
      if (!stat.isFile() || stat.size > MAX_CIPHERTEXT_BYTES)
        throw new Error("Invalid account storage.");
      assertAvailable();
      const decoded = encryption.decryptString(FS.readFileSync(filePath));
      const parsed: unknown = decoded.startsWith("{") ? JSON.parse(decoded) : { token: decoded };
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !("token" in parsed) ||
        typeof parsed.token !== "string" ||
        !parsed.token ||
        Buffer.byteLength(parsed.token) > MAX_TOKEN_BYTES
      ) {
        throw new Error("Invalid stored account session.");
      }
      const verified = "verified" in parsed ? parsed.verified : undefined;
      if (verified !== undefined) {
        if (
          !verified ||
          typeof verified !== "object" ||
          !("expiresAt" in verified) ||
          typeof verified.expiresAt !== "number" ||
          !Number.isFinite(verified.expiresAt) ||
          !("account" in verified) ||
          !verified.account ||
          typeof verified.account !== "object" ||
          !("accountId" in verified.account) ||
          typeof verified.account.accountId !== "string" ||
          !("email" in verified.account) ||
          typeof verified.account.email !== "string"
        ) {
          throw new Error("Invalid verified account storage.");
        }
        return {
          token: parsed.token,
          verified: {
            expiresAt: verified.expiresAt,
            account: { accountId: verified.account.accountId, email: verified.account.email },
          },
        };
      }
      return { token: parsed.token };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  return {
    assertAvailable,
    read() {
      if (suppressed || FS.existsSync(logoutMarker)) return null;
      const saved = readSaved();
      if (saved) return saved.token;
      if (FS.existsSync(importMarker) || !readLegacyToken) return null;
      assertAvailable();
      return readLegacyToken();
    },
    readVerifiedAccount(token) {
      if (suppressed || FS.existsSync(logoutMarker)) return null;
      const saved = readSaved();
      return saved?.token === token ? (saved.verified ?? null) : null;
    },
    write(token, verified) {
      assertAvailable();
      if (!token || Buffer.byteLength(token) > MAX_TOKEN_BYTES)
        throw new Error("Invalid account session.");
      const bytes = encryption.encryptString(
        JSON.stringify({ token, ...(verified ? { verified } : {}) }),
      );
      if (bytes.length > MAX_CIPHERTEXT_BYTES)
        throw new Error("Invalid encrypted account session.");
      FS.mkdirSync(profilePath, { recursive: true, mode: 0o700 });
      const temporaryPath = `${filePath}.${Crypto.randomUUID()}.tmp`;
      let descriptor: number | undefined;
      try {
        descriptor = FS.openSync(temporaryPath, "wx", 0o600);
        FS.writeFileSync(descriptor, bytes);
        FS.fsyncSync(descriptor);
        FS.closeSync(descriptor);
        descriptor = undefined;
        FS.renameSync(temporaryPath, filePath);
        mark(importMarker);
        FS.rmSync(logoutMarker, { force: true });
        suppressed = false;
      } finally {
        if (descriptor !== undefined) FS.closeSync(descriptor);
        FS.rmSync(temporaryPath, { force: true });
      }
    },
    clear() {
      // Suppress in memory first, including when the filesystem cannot complete logout.
      suppressed = true;
      mark(logoutMarker);
      mark(importMarker);
      FS.rmSync(filePath, { force: true });
    },
  };
}
