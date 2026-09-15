import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readLegacyGraftRelayCredential } from "./graftRelayCredential";

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);

describe("legacy Graft relay credential migration", () => {
  it("reads only the relay entry from the stable legacy profile and leaves it untouched", () => {
    const appData = mkdtempSync(join(tmpdir(), "graft-legacy-relay-"));
    directories.push(appData);
    const directory = join(appData, "@graft", "desktop", "remote-gateway");
    mkdirSync(directory, { recursive: true });
    const contents = JSON.stringify({
      version: 1,
      secrets: {
        "relay-uplink": Buffer.from("encrypted-relay").toString("base64"),
        "phone-secret": "unrelated",
      },
    });
    const path = join(directory, "secrets.json");
    writeFileSync(path, contents);
    const decryptString = vi.fn(() => '{"environmentId":"one"}');
    expect(
      readLegacyGraftRelayCredential({
        appData,
        platform: "darwin",
        safeStorage: {
          isEncryptionAvailable: () => true,
          decryptString,
        },
      }),
    ).toBe('{"environmentId":"one"}');
    expect(decryptString).toHaveBeenCalledExactlyOnceWith(Buffer.from("encrypted-relay"));
    expect(readFileSync(path, "utf8")).toBe(contents);
  });

  it("declines insecure Linux storage and handles unavailable legacy keys", () => {
    const decryptString = vi.fn(() => {
      throw new Error("wrong app key");
    });
    expect(
      readLegacyGraftRelayCredential({
        appData: "/missing",
        platform: "linux",
        safeStorage: {
          isEncryptionAvailable: () => true,
          getSelectedStorageBackend: () => "basic_text",
          decryptString,
        },
      }),
    ).toBeNull();
    expect(decryptString).not.toHaveBeenCalled();
  });
});
