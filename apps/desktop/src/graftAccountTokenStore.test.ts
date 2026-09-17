import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountStorageUnavailable, createGraftAccountTokenStore } from "./graftAccountTokenStore";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    FS.rmSync(directory, { recursive: true, force: true });
});

function harness() {
  const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "graft-account-store-"));
  directories.push(directory);
  const encryption = {
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => "gnome_libsecret"),
    encryptString: vi.fn((value: string) => Buffer.from(Buffer.from(value).toString("base64"))),
    decryptString: vi.fn((value: Buffer) => Buffer.from(value.toString(), "base64").toString()),
  };
  return { directory, encryption, store: createGraftAccountTokenStore(directory, encryption) };
}

describe("Graft account token storage", () => {
  it("persists only encrypted bytes privately and reads them after restart", () => {
    const { directory, encryption, store } = harness();
    expect(store.read()).toBeNull();
    store.write("private-account-token");
    const file = Path.join(directory, "graft-account.enc");
    expect(FS.readFileSync(file, "utf8")).not.toContain("private-account-token");
    if (process.platform !== "win32") expect(FS.statSync(file).mode & 0o777).toBe(0o600);
    expect(createGraftAccountTokenStore(directory, encryption).read()).toBe(
      "private-account-token",
    );
    store.clear();
    expect(store.read()).toBeNull();
    expect(FS.readdirSync(directory)).toEqual([
      "graft-account-imported",
      "graft-account-signed-out",
    ]);
  });

  it("refuses Linux plaintext fallback and an unavailable keyring without destroying the saved token", () => {
    const { directory, encryption, store } = harness();
    store.write("saved-token");
    const original = FS.readFileSync(Path.join(directory, "graft-account.enc"));
    encryption.getSelectedStorageBackend.mockReturnValue("basic_text");
    expect(() => store.write("new-token")).toThrow(AccountStorageUnavailable);
    expect(() => store.read()).toThrow(AccountStorageUnavailable);
    encryption.getSelectedStorageBackend.mockReturnValue("gnome_libsecret");
    encryption.isEncryptionAvailable.mockReturnValue(false);
    expect(() => store.write("new-token")).toThrow(AccountStorageUnavailable);
    expect(FS.readFileSync(Path.join(directory, "graft-account.enc"))).toEqual(original);
    store.clear();
    expect(store.read()).toBeNull();
  });

  it("preserves the previous token when encryption fails", () => {
    const { directory, encryption, store } = harness();
    store.write("saved-token");
    encryption.encryptString.mockImplementation(() => {
      throw new Error("keyring locked");
    });
    expect(() => store.write("new-token")).toThrow();
    expect(store.read()).toBe("saved-token");
    expect(FS.readdirSync(directory).sort()).toEqual([
      "graft-account-imported",
      "graft-account.enc",
    ]);
  });

  it("rejects oversized and symlinked credential files", () => {
    const { directory, store } = harness();
    const file = Path.join(directory, "graft-account.enc");
    FS.writeFileSync(file, Buffer.alloc(33 * 1024));
    expect(() => store.read()).toThrow("Invalid account storage");
    if (process.platform !== "win32") {
      FS.rmSync(file);
      FS.symlinkSync(Path.join(directory, "other"), file);
      expect(() => store.read()).toThrow("Invalid account storage");
    }
  });
  it("persists verified identity with its exact token and never reimports after logout", () => {
    const { directory, encryption } = harness();
    const readLegacy = vi.fn(() => "legacy-token");
    const store = createGraftAccountTokenStore(directory, encryption, readLegacy);
    expect(store.read()).toBe("legacy-token");
    const verified = {
      account: { accountId: "existing-account", email: "user@example.test" },
      expiresAt: Date.now() + 60_000,
    };
    store.write("legacy-token", verified);
    expect(
      createGraftAccountTokenStore(directory, encryption).readVerifiedAccount?.("legacy-token"),
    ).toEqual(verified);
    expect(store.readVerifiedAccount?.("another-token")).toBeNull();
    store.clear();
    expect(createGraftAccountTokenStore(directory, encryption, readLegacy).read()).toBeNull();
    expect(readLegacy).toHaveBeenCalledOnce();
  });

  it("honors a durable sign-out marker even if the old encrypted file remains after a failed deletion", () => {
    const { directory, encryption, store } = harness();
    store.write("old-token");
    FS.writeFileSync(Path.join(directory, "graft-account-signed-out"), "1\n");
    expect(createGraftAccountTokenStore(directory, encryption).read()).toBeNull();
    store.write("new-login");
    expect(createGraftAccountTokenStore(directory, encryption).read()).toBe("new-login");
  });
});
