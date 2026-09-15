import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { describe, expect, it } from "vitest";

import {
  acknowledgeGraftStorageSnapshot,
  readGraftStorageSnapshot,
  GRAFT_STORAGE_SNAPSHOT_MAX_BYTES,
  validateGraftStorageSnapshot,
} from "./desktopStorageMigration";

const snapshot = () => ({
  version: 1 as const,
  exportedAt: "2026-07-09T00:00:00.000Z",
  entries: {
    "graft:theme": "dark",
    "graft.openUsage.enabled": "true",
  },
});

describe("desktopStorageMigration", () => {
  it("reads a legacy snapshot and removes it after acknowledgement", async () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "graft-storage-migration-"));
    const target = Path.join(directory, "snapshot.json");
    try {
      FS.writeFileSync(target, `${JSON.stringify(snapshot())}\n`);
      expect(readGraftStorageSnapshot(target)).toEqual(snapshot());

      await acknowledgeGraftStorageSnapshot(target);
      expect(readGraftStorageSnapshot(target)).toBeNull();
    } finally {
      FS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed, disallowed, and oversized snapshots", () => {
    expect(validateGraftStorageSnapshot({ version: 1 })).toBeNull();
    expect(
      validateGraftStorageSnapshot({
        ...snapshot(),
        entries: { "foreign:theme": "dark" },
      }),
    ).toBeNull();
    expect(
      validateGraftStorageSnapshot({
        ...snapshot(),
        entries: { "graft:large": "x".repeat(GRAFT_STORAGE_SNAPSHOT_MAX_BYTES) },
      }),
    ).toBeNull();
  });

  it("accepts renderer snapshots containing large composer drafts", () => {
    const largeDraft = "x".repeat(2 * 1024 * 1024);

    expect(
      validateGraftStorageSnapshot({
        ...snapshot(),
        entries: { "graft:composer-drafts:v1": largeDraft },
      })?.entries["graft:composer-drafts:v1"],
    ).toBe(largeDraft);
  });

  it("treats missing and malformed files as absent", () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "graft-storage-migration-"));
    const target = Path.join(directory, "snapshot.json");
    try {
      expect(readGraftStorageSnapshot(target)).toBeNull();
      FS.writeFileSync(target, "not json");
      expect(readGraftStorageSnapshot(target)).toBeNull();
    } finally {
      FS.rmSync(directory, { recursive: true, force: true });
    }
  });
});
