// FILE: storageOriginMigration.ts
// Purpose: Imports Graft browser state before renderer stores hydrate after a desktop origin move.

import type { GraftStorageSnapshot } from "@graft/contracts";

const MAX_SNAPSHOT_ENTRIES = 2_048;
const MAX_SNAPSHOT_KEY_LENGTH = 512;
const MAX_SNAPSHOT_VALUE_LENGTH = 16 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

function canonicalizeStorageKey(key: string): string {
  if (key.startsWith("synara:")) return `graft:${key.slice("synara:".length)}`;
  if (key.startsWith("synara.")) return `graft.${key.slice("synara.".length)}`;
  return key;
}

function isImportableStorageKey(key: string): boolean {
  return (
    key.startsWith("graft:") ||
    key.startsWith("graft.") ||
    key.startsWith("synara:") ||
    key.startsWith("synara.")
  );
}

function migrateLegacyStorageKeys(storage: Storage): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  for (const key of keys) {
    const canonical = canonicalizeStorageKey(key);
    if (canonical === key) continue;
    if (storage.getItem(canonical) === null) {
      const value = storage.getItem(key);
      if (value !== null) storage.setItem(canonical, value);
    }
    storage.removeItem(key);
  }
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function importGraftStorageSnapshot(
  snapshot: GraftStorageSnapshot | null,
  storage = getLocalStorage(),
): boolean {
  if (!snapshot || !storage || snapshot.version !== 1 || !snapshot.entries) return false;
  const entries = Object.entries(snapshot.entries);
  if (entries.length > MAX_SNAPSHOT_ENTRIES) return false;

  try {
    if (
      !Number.isFinite(Date.parse(snapshot.exportedAt)) ||
      new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_SNAPSHOT_BYTES
    ) {
      return false;
    }
    for (const [key, value] of entries) {
      if (
        !isImportableStorageKey(key) ||
        key.length > MAX_SNAPSHOT_KEY_LENGTH ||
        typeof value !== "string" ||
        value.length > MAX_SNAPSHOT_VALUE_LENGTH
      ) {
        return false;
      }
    }
    for (const [key, value] of entries) {
      const canonical = canonicalizeStorageKey(key);
      if (storage.getItem(canonical) === null) storage.setItem(canonical, value);
    }
    migrateLegacyStorageKeys(storage);
    return true;
  } catch {
    return false;
  }
}

export function bootstrapGraftStorageOriginMigration(): void {
  const bridge = globalThis.window?.desktopBridge?.storageMigration;
  if (!bridge) return;

  try {
    const snapshot = bridge.readSnapshot();
    if (snapshot && importGraftStorageSnapshot(snapshot)) {
      void bridge.acknowledgeSnapshot().catch(() => undefined);
    }
    const storage = getLocalStorage();
    if (storage) migrateLegacyStorageKeys(storage);
  } catch {
    // Keep the snapshot for a later retry if preload or storage is unavailable.
  }
}

bootstrapGraftStorageOriginMigration();
