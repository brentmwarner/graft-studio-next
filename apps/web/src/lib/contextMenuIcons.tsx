// FILE: contextMenuIcons.tsx
// Purpose: Icons for imperative context menus, matching the glyphs the same actions use in React UI.
// Layer: web UI utility
// Exports: THREAD_CONTEXT_MENU_ICONS
// Why: Native menus load Central glyphs by basename; React's masked spans cannot be rasterized.

import {
  ARCHIVE_ICON_NAME,
  BELL_ICON_NAME,
  COPY_ICON_NAME,
  EYE_OPEN_ICON_NAME,
  HANDOFF_ICON_NAME,
  PENCIL_ICON_NAME,
  PIN_ICON_NAME,
  TERMINAL_ICON_NAME,
  TRASH_ICON_NAME,
} from "./icons";

export const THREAD_CONTEXT_MENU_ICONS = {
  rename: PENCIL_ICON_NAME,
  pin: PIN_ICON_NAME,
  clearNotification: BELL_ICON_NAME,
  markUnread: EYE_OPEN_ICON_NAME,
  handoff: HANDOFF_ICON_NAME,
  copy: COPY_ICON_NAME,
  openInTerminal: TERMINAL_ICON_NAME,
  // Same glyph as the thread row's hover archive button.
  archive: ARCHIVE_ICON_NAME,
  // Same glyph as the delete rows in the sidebar project and space menus.
  delete: TRASH_ICON_NAME,
} as const;
