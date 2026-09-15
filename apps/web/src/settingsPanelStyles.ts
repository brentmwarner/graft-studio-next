// FILE: settingsPanelStyles.ts
// Purpose: Shared layout tokens for the settings content panel (page bg, bordered cards, rows).
// Layer: Settings UI styling
// Exports: border, surface, card, row, and inset list class names

import { SIDEBAR_SECTION_LABEL_CLASS_NAME } from "./sidebarRowStyles";

/** Corner radius for top-level settings boxes: cards, empty states, dropdown panels. */
export const SETTINGS_RADIUS_CLASS_NAME = "rounded-2xl";

/** One step inside {@link SETTINGS_RADIUS_CLASS_NAME}, for anything that sits within a card
 *  (inset lists, rows) or is too small to carry the card radius (chips, drag handles). */
export const SETTINGS_INSET_RADIUS_CLASS_NAME = "rounded-lg";

/** The inset radius forced over a component's own default (Select triggers, segmented chips,
 *  inputs, menu options all ship a radius of their own). Written as a literal because Tailwind
 *  scans source text for candidates — a template-built `!${...}` class emits no CSS at all. */
export const SETTINGS_CONTROL_RADIUS_CLASS_NAME = "rounded-lg!";

/** Same border token as Button `outline` / `chrome-outline` variants. */
export const SETTINGS_CONTROL_BORDER_CLASS_NAME = "border border-[color:var(--color-border)]";

/** Main settings shell — opaque and matched to the chat surface (see `--app-settings-surface`),
 *  so cards/rows read as outline-only on the same background as the chat. */
export const SETTINGS_PAGE_BACKGROUND_CLASS_NAME = "app-settings-surface";

/** Section label above a settings card — same tone as sidebar "Threads"/"Pinned". */
export const SETTINGS_SECTION_LABEL_CLASS_NAME = `px-2 py-1 ${SIDEBAR_SECTION_LABEL_CLASS_NAME}`;

/** Vertical rhythm between stacked settings groups in the content panel. */
export const SETTINGS_PANEL_SECTION_CLASS_NAME = "flex flex-col gap-1.5 not-first:mt-4";

/** Outlined groups share the page surface; controls retain their own fill. */
export const SETTINGS_CARD_CLASS_NAME = [
  "overflow-hidden",
  "bg-transparent",
  SETTINGS_CONTROL_BORDER_CLASS_NAME,
  SETTINGS_RADIUS_CLASS_NAME,
].join(" ");

/** Row padding inside a settings card. */
export const SETTINGS_CARD_ROW_CLASS_NAME =
  "px-4 py-[var(--app-density-settings-row-padding-y,0.625rem)]";

/** Row title — same UI font/size as the description; weight and color differ. */
export const SETTINGS_CARD_ROW_TITLE_CLASS_NAME =
  "text-[length:var(--app-font-size-ui,12px)] font-medium text-foreground";

/** Row description — standard app UI typography. */
export const SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME =
  "text-[length:var(--app-font-size-ui,12px)] text-muted-foreground";

/** Divider between stacked rows inside one card. */
export const SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME = "settings-divider";

/** Hairlines between the stacked children of a card or inset list. Applied by
 *  {@link SETTINGS_CARD_CLASS_NAME} consumers (`SettingsCard`) and by any surface that
 *  stacks rows itself, so every settings group separates its rows the same way. */
export const SETTINGS_STACKED_ROWS_DIVIDER_CLASS_NAME = "settings-divided";

/** Outlined block nested inside a settings group (a reorderable row, a bordered panel).
 *  Outline-only, matching the parent card without stacking background fills. */
export const SETTINGS_OUTLINED_SURFACE_CLASS_NAME = [
  "bg-transparent",
  SETTINGS_CONTROL_BORDER_CLASS_NAME,
  SETTINGS_INSET_RADIUS_CLASS_NAME,
].join(" ");

/** Nested list/table inside a row (provider installs, updates, etc.) — an outlined surface
 *  that clips its stacked children so their corners follow the list's. */
export const SETTINGS_INSET_LIST_CLASS_NAME = `overflow-hidden ${SETTINGS_OUTLINED_SURFACE_CLASS_NAME}`;

/** Empty / placeholder blocks. */
export const SETTINGS_EMPTY_STATE_CLASS_NAME = [
  "bg-transparent",
  SETTINGS_CONTROL_BORDER_CLASS_NAME,
  SETTINGS_RADIUS_CLASS_NAME,
].join(" ");
