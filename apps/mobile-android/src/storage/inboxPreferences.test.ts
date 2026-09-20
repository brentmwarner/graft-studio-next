import { afterEach, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItemSync: (key: string) => storage.get(key) ?? null,
    setItemSync: (key: string, value: string) => {
      storage.set(key, value);
    },
  },
}));

import { inboxViewModeKey, loadInboxViewMode, saveInboxViewMode } from "./inboxPreferences";

afterEach(() => {
  storage.clear();
});

it("scopes the inbox view mode to the paired computer", () => {
  expect(inboxViewModeKey("mac")).toBe("inbox.viewMode.mac");
  saveInboxViewMode("priority", "mac");
  saveInboxViewMode("chronological", "studio");
  expect(loadInboxViewMode("mac")).toBe("priority");
  expect(loadInboxViewMode("studio")).toBe("chronological");
  expect(loadInboxViewMode()).toBe("project");
});

it("copies a legacy device-wide preference onto the first computer", () => {
  storage.set("inbox.viewMode", "priority");
  expect(loadInboxViewMode("mac")).toBe("priority");
  expect(storage.get("inbox.viewMode.mac")).toBe("priority");
  saveInboxViewMode("chronological", "studio");
  expect(loadInboxViewMode("studio")).toBe("chronological");
  expect(loadInboxViewMode("mac")).toBe("priority");
});
