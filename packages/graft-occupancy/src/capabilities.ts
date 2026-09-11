import type { GraftDesktopCapability } from "@graft/desktop-contract";

/** Commands the v1 occupancy adapter actually dispatches. */
export const HEADLESS_HOST_CAPABILITIES = [
  "projects",
  "threads",
] as const satisfies readonly GraftDesktopCapability[];
