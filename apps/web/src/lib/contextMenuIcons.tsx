// FILE: contextMenuIcons.tsx
// Purpose: Icons for imperative context menus, matching the glyphs the same actions use in React UI.
// Layer: web UI utility
// Exports: THREAD_CONTEXT_MENU_ICONS
// Why: Native menus cannot render React components, so Central glyphs are passed by basename and
//      other icon sets are rendered to SVG markup from the same components the app shows.

import {
  ARCHIVE_ICON_NAME,
  BELL_ICON_NAME,
  COPY_ICON_NAME,
  EYE_OPEN_ICON_NAME,
  HANDOFF_ICON_NAME,
  PENCIL_ICON_NAME,
  PIN_ICON_NAME,
  TERMINAL_ICON_NAME,
  TRASH_CAN_ICON_NAME,
} from "./icons";

export const THREAD_CONTEXT_MENU_ICONS = {
  rename: PENCIL_ICON_NAME,
  pin: PIN_ICON_NAME,
  clearNotification: BELL_ICON_NAME,
  markUnread: EYE_OPEN_ICON_NAME,
  handoff: HANDOFF_ICON_NAME,
  copy: COPY_ICON_NAME,
  openInTerminal: TERMINAL_ICON_NAME,
  // Same Central glyph as ThreadArchiveActionButton / ArchiveIcon.
  archive: ARCHIVE_ICON_NAME,
  // Same Central glyph as Trash2 / TrashCanIcon. Basename, not React markup:
  // native menus rasterize Central names or inline <svg>, not CSS-mask spans.
  delete: TRASH_CAN_ICON_NAME,
} as const;
