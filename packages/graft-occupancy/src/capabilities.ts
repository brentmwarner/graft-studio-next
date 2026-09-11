import type { GraftDesktopCapability } from "@graft/desktop-contract";

export const HEADLESS_HOST_CAPABILITIES = [
  "projects",
  "threads",
  "runs",
  "providers",
  "files",
  "git",
  "worktrees",
  "terminals",
  "usage",
  "cursor_replay",
  "bulk_transfer",
  "diagnostics",
] as const satisfies readonly GraftDesktopCapability[];
