import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EncryptedFileRemoteSessionSecretStore,
  InvalidRemoteSessionSecretStoreError,
  RemoteSessionSecretStoreUnavailableError,
  type RemoteSessionSafeStorage,
} from "./remoteSessionSecretStore.js";

const SENTINEL_SECRET = "bearer-token-SENTINEL-123";

interface MockSafeStorage extends RemoteSessionSafeStorage {
  available: boolean;
  backend: string;
  failEncryptCount: number;
}

let tempDirectory = "";
let secretFile = "";
let safeStorage: MockSafeStorage;

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "graft-remote-secret-store-"));
  secretFile = join(tempDirectory, "remote-session-secrets.json");
  safeStorage = createSafeStorage();
});

afterEach(() => {
  rmSync(tempDirectory, { recursive: true, force: true });
});

describe("EncryptedFileRemoteSessionSecretStore", () => {
  it("roundtrips secrets across reopen and deletes accounts idempotently", () => {
    const store = createStore();

    expect(store.get("missing-account")).toBeNull();
    store.set("session:one", SENTINEL_SECRET);
    store.set("push:two", "apns-token-value");

    const reopened = createStore();
    expect(reopened.get("session:one")).toBe(SENTINEL_SECRET);
    expect(reopened.get("push:two")).toBe("apns-token-value");

    reopened.delete("session:one");
    reopened.delete("session:one");
    const reopenedAfterDelete = createStore();
    expect(reopenedAfterDelete.get("session:one")).toBeNull();
    expect(reopenedAfterDelete.get("push:two")).toBe("apns-token-value");
  });

  it("persists only base64 ciphertext and no sentinel plaintext", () => {
    createStore().set("session:one", SENTINEL_SECRET);

    const serialized = readFileSync(secretFile, "utf-8");
    expect(serialized).not.toContain(SENTINEL_SECRET);
    expect(JSON.parse(serialized)).toEqual({
      version: 1,
      secrets: {
        "session:one": Buffer.from(
          `safe:${Buffer.from(SENTINEL_SECRET, "utf-8").toString("base64")}`,
          "utf-8",
        ).toString("base64"),
      },
    });
  });

  it("rejects malformed envelopes and corrupt ciphertext", () => {
    writeFileSync(secretFile, "{", { mode: 0o600 });
    expect(() => createStore().get("session:one")).toThrow(InvalidRemoteSessionSecretStoreError);

    writeFileSync(
      secretFile,
      JSON.stringify({ version: 1, secrets: { "session:one": "not-base64" } }),
      { mode: 0o600 },
    );
    expect(() => createStore().get("session:one")).toThrow(InvalidRemoteSessionSecretStoreError);

    writeFileSync(
      secretFile,
      JSON.stringify({
        version: 1,
        secrets: {
          "session:one": Buffer.from("wrong-prefix", "utf-8").toString("base64"),
        },
      }),
      { mode: 0o600 },
    );
    expect(() => createStore().get("session:one")).toThrow(InvalidRemoteSessionSecretStoreError);
  });

  it("fails closed when encryption is unavailable or Linux storage is insecure", () => {
    safeStorage.available = false;
    expect(() => createStore().set("session:one", SENTINEL_SECRET)).toThrow(
      RemoteSessionSecretStoreUnavailableError,
    );
    expect(readdirSync(tempDirectory)).toEqual([]);

    safeStorage.available = true;
    safeStorage.backend = "basic_text";
    expect(() => createStore({ platform: "linux" }).set("session:one", SENTINEL_SECRET)).toThrow(
      RemoteSessionSecretStoreUnavailableError,
    );
    expect(readdirSync(tempDirectory)).toEqual([]);

    safeStorage.backend = "unknown";
    expect(() => createStore({ platform: "linux" }).set("session:one", SENTINEL_SECRET)).toThrow(
      RemoteSessionSecretStoreUnavailableError,
    );
    expect(readdirSync(tempDirectory)).toEqual([]);
  });

  it("applies restricted POSIX directory and file modes", () => {
    createStore().set("session:one", SENTINEL_SECRET);

    if (process.platform === "win32") return;

    expect(lstatSync(tempDirectory).mode & 0o777).toBe(0o700);
    expect(lstatSync(secretFile).mode & 0o777).toBe(0o600);
  });

  it("rejects symlink and non-file store paths", () => {
    const target = join(tempDirectory, "target.json");
    writeFileSync(target, "{}", { mode: 0o600 });
    symlinkSync(target, secretFile);

    expect(() => createStore().set("session:one", SENTINEL_SECRET)).toThrow(
      InvalidRemoteSessionSecretStoreError,
    );
  });

  it("uses atomic replacement without leaving temp files behind", () => {
    const store = createStore();
    store.set("session:one", "first-secret");
    store.set("session:one", "second-secret");

    expect(createStore().get("session:one")).toBe("second-secret");
    expect(readdirSync(tempDirectory)).toEqual(["remote-session-secrets.json"]);
  });

  it("does not expose an unpersisted value after encryption fails", () => {
    const store = createStore();
    store.set("session:one", "persisted-secret");
    safeStorage.failEncryptCount = 1;

    expect(() => store.set("session:one", "unpersisted-secret")).toThrow();
    expect(store.get("session:one")).toBe("persisted-secret");
    expect(createStore().get("session:one")).toBe("persisted-secret");
  });
});

function createStore(options?: {
  platform?: NodeJS.Platform;
}): EncryptedFileRemoteSessionSecretStore {
  return new EncryptedFileRemoteSessionSecretStore({
    filePath: secretFile,
    safeStorage,
    platform: options?.platform ?? "darwin",
  });
}

function createSafeStorage(): MockSafeStorage {
  return {
    available: true,
    backend: "gnome_libsecret",
    failEncryptCount: 0,
    isEncryptionAvailable() {
      return this.available;
    },
    getSelectedStorageBackend() {
      return this.backend;
    },
    encryptString(plaintext: string) {
      if (this.failEncryptCount > 0) {
        this.failEncryptCount -= 1;
        throw new Error("encryption failed");
      }
      return Buffer.from(`safe:${Buffer.from(plaintext, "utf-8").toString("base64")}`, "utf-8");
    },
    decryptString(encrypted: Buffer) {
      const serialized = encrypted.toString("utf-8");
      if (!serialized.startsWith("safe:")) {
        throw new Error("invalid ciphertext");
      }
      return Buffer.from(serialized.slice("safe:".length), "base64").toString("utf-8");
    },
  };
}
