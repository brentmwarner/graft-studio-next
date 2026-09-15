export type IosPairingSurface = "welcome" | "scan" | "paste";
export type IosPairingAction = "close" | "openPairing" | "pasteInstead" | "scanInstead";

export function iosPairingSurfaceAfter(
  action: IosPairingAction,
  hasPendingLink = false,
): IosPairingSurface {
  switch (action) {
    case "close":
      return "welcome";
    case "openPairing":
      return hasPendingLink ? "paste" : "scan";
    case "pasteInstead":
      return "paste";
    case "scanInstead":
      return "scan";
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
