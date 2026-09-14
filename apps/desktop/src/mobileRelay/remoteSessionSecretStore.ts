import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const SECRET_DIRECTORY_MODE = 0o700;
const SECRET_FILE_MODE = 0o600;
const ENVELOPE_VERSION = 1;

export interface RemoteSessionSecretStore {
  get(accountKey: string): string | null;
  set(accountKey: string, secret: string): void;
  delete(accountKey: string): void;
}

export type SafeStorageBackend =
  | "basic_text"
  | "gnome_libsecret"
  | "kwallet"
  | "kwallet5"
  | "kwallet6"
  | "unknown"
  | string;

export interface RemoteSessionSafeStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): SafeStorageBackend;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class RemoteSessionSecretStoreUnavailableError extends Error {
  constructor() {
    super("Remote session secret storage is unavailable");
    this.name = "RemoteSessionSecretStoreUnavailableError";
  }
}

export class InvalidRemoteSessionSecretStoreError extends Error {
  constructor() {
    super("Remote session secret store is invalid");
    this.name = "InvalidRemoteSessionSecretStoreError";
  }
}

export interface RemoteSessionSecretStoreOptions {
  filePath: string;
  safeStorage: RemoteSessionSafeStorage;
  platform?: NodeJS.Platform;
}

interface RemoteSessionSecretEnvelope {
  version: 1;
  secrets: Record<string, string>;
}

export class EncryptedFileRemoteSessionSecretStore implements RemoteSessionSecretStore {
  private cache: Record<string, string> | null = null;
  private readonly filePath: string;
  private readonly platform: NodeJS.Platform;
  private readonly safeStorage: RemoteSessionSafeStorage;

  constructor(options: RemoteSessionSecretStoreOptions) {
    this.filePath = options.filePath;
    this.safeStorage = options.safeStorage;
    this.platform = options.platform ?? process.platform;
  }

  get(accountKey: string): string | null {
    validateAccountKey(accountKey);
    const secrets = this.load();
    return secrets[accountKey] ?? null;
  }

  set(accountKey: string, secret: string): void {
    validateAccountKey(accountKey);
    const storage = this.requireSafeStorage();
    const secrets = this.loadWithStorage(storage);
    const nextSecrets = { ...secrets, [accountKey]: secret };
    this.write(nextSecrets, storage);
    this.cache = nextSecrets;
  }

  delete(accountKey: string): void {
    validateAccountKey(accountKey);
    if (!restrictedFileExists(this.filePath)) {
      if (this.cache) {
        delete this.cache[accountKey];
      }
      return;
    }
    const storage = this.requireSafeStorage();
    const secrets = this.loadWithStorage(storage);
    if (!(accountKey in secrets)) return;
    const nextSecrets = { ...secrets };
    delete nextSecrets[accountKey];
    this.write(nextSecrets, storage);
    this.cache = nextSecrets;
  }

  private load(): Record<string, string> {
    if (this.cache) return this.cache;
    const storage = this.requireSafeStorage();
    return this.loadWithStorage(storage);
  }

  private loadWithStorage(storage: RemoteSessionSafeStorage): Record<string, string> {
    if (this.cache) return this.cache;

    const serialized = readRestrictedFile(this.filePath);
    if (serialized === null) {
      this.cache = {};
      return this.cache;
    }

    const envelope = parseEnvelope(serialized);
    const decrypted: Record<string, string> = {};
    for (const [accountKey, ciphertext] of Object.entries(envelope.secrets)) {
      try {
        decrypted[accountKey] = storage.decryptString(parseBase64Ciphertext(ciphertext));
      } catch {
        throw new InvalidRemoteSessionSecretStoreError();
      }
    }
    this.cache = decrypted;
    return this.cache;
  }

  private write(secrets: Record<string, string>, storage: RemoteSessionSafeStorage): void {
    const encrypted: Record<string, string> = {};
    for (const [accountKey, secret] of Object.entries(secrets)) {
      encrypted[accountKey] = storage.encryptString(secret).toString("base64");
    }

    const envelope: RemoteSessionSecretEnvelope = {
      version: ENVELOPE_VERSION,
      secrets: encrypted,
    };
    writeRestrictedFileAtomically(this.filePath, JSON.stringify(envelope));
  }

  private requireSafeStorage(): RemoteSessionSafeStorage {
    try {
      if (!this.safeStorage.isEncryptionAvailable()) {
        throw new RemoteSessionSecretStoreUnavailableError();
      }
      if (this.platform === "linux") {
        const backend = this.safeStorage.getSelectedStorageBackend?.() ?? "unknown";
        if (backend === "basic_text" || backend === "unknown") {
          throw new RemoteSessionSecretStoreUnavailableError();
        }
      }
      return this.safeStorage;
    } catch (error) {
      if (error instanceof RemoteSessionSecretStoreUnavailableError) {
        throw error;
      }
      throw new RemoteSessionSecretStoreUnavailableError();
    }
  }
}

function validateAccountKey(accountKey: string): void {
  if (accountKey.length === 0) {
    throw new InvalidRemoteSessionSecretStoreError();
  }
}

function parseEnvelope(serialized: string): RemoteSessionSecretEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new InvalidRemoteSessionSecretStoreError();
  }
  if (!isPlainRecord(parsed) || !hasExactKeys(parsed, ["secrets", "version"])) {
    throw new InvalidRemoteSessionSecretStoreError();
  }
  if (parsed.version !== ENVELOPE_VERSION || !isPlainRecord(parsed.secrets)) {
    throw new InvalidRemoteSessionSecretStoreError();
  }

  const secrets: Record<string, string> = {};
  for (const [accountKey, ciphertext] of Object.entries(parsed.secrets)) {
    if (typeof ciphertext !== "string") {
      throw new InvalidRemoteSessionSecretStoreError();
    }
    validateAccountKey(accountKey);
    parseBase64Ciphertext(ciphertext);
    secrets[accountKey] = ciphertext;
  }
  return { version: ENVELOPE_VERSION, secrets };
}

function parseBase64Ciphertext(ciphertext: string): Buffer {
  if (
    ciphertext.length === 0 ||
    ciphertext.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(ciphertext)
  ) {
    throw new InvalidRemoteSessionSecretStoreError();
  }
  const decoded = Buffer.from(ciphertext, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== ciphertext) {
    throw new InvalidRemoteSessionSecretStoreError();
  }
  return decoded;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function prepareRestrictedDirectory(filePath: string): string {
  const directoryPath = dirname(filePath);
  mkdirSync(directoryPath, {
    recursive: true,
    mode: SECRET_DIRECTORY_MODE,
  });
  if (process.platform !== "win32") {
    const stat = lstatSync(directoryPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new InvalidRemoteSessionSecretStoreError();
    }
    chmodSync(directoryPath, SECRET_DIRECTORY_MODE);
  }
  return directoryPath;
}

function restrictedFileExists(filePath: string): boolean {
  prepareRestrictedDirectory(filePath);
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new InvalidRemoteSessionSecretStoreError();
    }
    return true;
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

function readRestrictedFile(filePath: string): string | null {
  prepareRestrictedDirectory(filePath);
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new InvalidRemoteSessionSecretStoreError();
    }
    if (process.platform !== "win32") {
      chmodSync(filePath, SECRET_FILE_MODE);
    }
    return readFileSync(filePath, "utf-8");
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

function writeRestrictedFileAtomically(filePath: string, serialized: string): void {
  const directoryPath = prepareRestrictedDirectory(filePath);
  restrictedFileExistsOrMissing(filePath);
  const fileName = basename(filePath);
  const tempPath = join(
    directoryPath,
    `.${fileName}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );

  let descriptor: number | null = null;
  try {
    descriptor = openSync(tempPath, "wx", SECRET_FILE_MODE);
    writeFileSync(descriptor, serialized, "utf-8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(tempPath, filePath);
    if (process.platform !== "win32") {
      chmodSync(filePath, SECRET_FILE_MODE);
    }
    syncDirectoryBestEffort(directoryPath);
  } catch (error) {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the original write error.
      }
    }
    try {
      unlinkSync(tempPath);
    } catch {
      // The temp file may not exist or may already have been renamed.
    }
    throw error;
  }
}

function restrictedFileExistsOrMissing(filePath: string): void {
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new InvalidRemoteSessionSecretStoreError();
    }
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
}

function syncDirectoryBestEffort(directoryPath: string): void {
  if (process.platform === "win32") return;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(directoryPath, "r");
    fsyncSync(descriptor);
  } catch {
    // Some filesystems do not support fsync on directories.
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // Best-effort durability only after the atomic rename completed.
      }
    }
  }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
