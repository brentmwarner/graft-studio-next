import Storage from "expo-sqlite/kv-store";

import { parseInboxViewMode, type InboxViewMode } from "../state/inboxGrouping";

const LEGACY_VIEW_MODE_KEY = "inbox.viewMode";

export function inboxViewModeKey(environmentId: string | undefined): string | undefined {
  return environmentId ? `${LEGACY_VIEW_MODE_KEY}.${environmentId}` : undefined;
}

export function loadInboxViewMode(environmentId?: string): InboxViewMode {
  const key = inboxViewModeKey(environmentId);
  if (!key) return "project";
  try {
    const scoped = Storage.getItemSync(key);
    if (scoped != null) return parseInboxViewMode(scoped);
    const legacy = Storage.getItemSync(LEGACY_VIEW_MODE_KEY);
    if (legacy != null) {
      Storage.setItemSync(key, legacy);
      return parseInboxViewMode(legacy);
    }
    return "project";
  } catch (error) {
    console.warn("Could not load inbox preference", error);
    return "project";
  }
}

export function saveInboxViewMode(mode: InboxViewMode, environmentId?: string): void {
  const key = inboxViewModeKey(environmentId);
  if (!key) return;
  try {
    Storage.setItemSync(key, mode);
  } catch (error) {
    console.warn("Could not save inbox preference", error);
  }
}
