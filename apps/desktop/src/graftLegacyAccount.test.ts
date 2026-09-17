import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readLegacyGraftAccountToken } from "./graftLegacyAccount";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "graft-legacy-account-"));
  directories.push(dir);
  const path = join(dir, "encrypted-credentials.json");
  const encryption = {
    isEncryptionAvailable: () => true,
    decryptString: vi.fn(() => "legacy-account-token"),
    encryptString: vi.fn(() => Buffer.alloc(0)),
  };
  return { dir, path, encryption };
}

describe("legacy account import", () => {
  it("reads only the encrypted account entry and leaves all legacy files untouched", () => {
    const { dir, path, encryption } = fixture();
    const envelope = JSON.stringify({
      encrypted: true,
      data: {
        "graft-studio-account:jwt": Buffer.from("encrypted-account").toString("base64"),
        "provider:key": "do-not-read",
      },
    });
    writeFileSync(path, envelope);
    expect(readLegacyGraftAccountToken(dir, encryption)).toBe("legacy-account-token");
    expect(encryption.decryptString).toHaveBeenCalledExactlyOnceWith(
      Buffer.from("encrypted-account"),
    );
    expect(readFileSync(path, "utf8")).toBe(envelope);
    expect(encryption.encryptString).not.toHaveBeenCalled();
  });
  it("honors durable legacy logout and rejects plaintext, damaged and symlinked envelopes", () => {
    const { dir, path, encryption } = fixture();
    writeFileSync(
      path,
      JSON.stringify({ encrypted: true, data: { "graft-studio-account:jwt": "YQ==" } }),
    );
    writeFileSync(
      join(dir, "credential-deletions.json"),
      JSON.stringify({
        version: 2,
        pendingDeletes: ["graft-studio-account:jwt"],
        disconnectedProviders: [],
        disconnectedInstanceIds: [],
      }),
    );
    expect(readLegacyGraftAccountToken(dir, encryption)).toBeNull();
    rmSync(join(dir, "credential-deletions.json"));
    writeFileSync(
      path,
      JSON.stringify({ encrypted: false, data: { "graft-studio-account:jwt": "YQ==" } }),
    );
    expect(readLegacyGraftAccountToken(dir, encryption)).toBeNull();
    writeFileSync(path, "{");
    expect(readLegacyGraftAccountToken(dir, encryption)).toBeNull();
    if (process.platform !== "win32") {
      rmSync(path);
      symlinkSync(join(dir, "missing"), path);
      expect(readLegacyGraftAccountToken(dir, encryption)).toBeNull();
    }
    expect(encryption.decryptString).not.toHaveBeenCalled();
  });
});
