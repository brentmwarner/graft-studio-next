export type IosPairingSurface = "welcome" | "scan" | "paste";

export type IosPairingAction = "close" | "openPairing" | "pasteInstead" | "scanInstead";

/// iOS pairing is a quiet camera scan. Paste is a full-screen fallback,
/// never a nested drawer over the scanner.
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
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
