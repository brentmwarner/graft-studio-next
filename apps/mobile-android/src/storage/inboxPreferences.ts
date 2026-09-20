import Storage from "expo-sqlite/kv-store";

import { parseInboxViewMode, type InboxViewMode } from "../state/inboxGrouping";

const VIEW_MODE_KEY = "inbox.viewMode";

export function loadInboxViewMode(): InboxViewMode {
  try {
    return parseInboxViewMode(Storage.getItemSync(VIEW_MODE_KEY));
  } catch (error) {
    console.warn("Could not load inbox preference", error);
    return "project";
  }
}

export function saveInboxViewMode(mode: InboxViewMode): void {
  try {
    Storage.setItemSync(VIEW_MODE_KEY, mode);
  } catch (error) {
    console.warn("Could not save inbox preference", error);
  }
}
