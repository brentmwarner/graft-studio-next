import type { GraftContextUsage } from "@graft/mobile-contract";

export function contextUsageAccessibilityLabel(
  usage: GraftContextUsage | undefined,
): string {
  return usage?.source === "measured"
    ? `Context: ${usage.percent}% used`
    : "Context usage unavailable";
}

export function contextUsageDetail(
  usage: GraftContextUsage | undefined,
): string {
  if (!usage || usage.source === "unknown") {
    return "This provider does not report context-window usage yet.";
  }
  if (usage.tokensMax <= 0) {
    return `${usage.percent}% of the context window is used.`;
  }
  return `${usage.percent}% used · ${formatTokenCount(usage.tokensUsed)} of ${formatTokenCount(usage.tokensMax)} tokens`;
}

export function contextProgressIconName(
  usage: GraftContextUsage | undefined,
):
  | "circle-outline"
  | "circle-slice-1"
  | "circle-slice-2"
  | "circle-slice-3"
  | "circle-slice-4"
  | "circle-slice-5"
  | "circle-slice-6"
  | "circle-slice-7"
  | "circle-slice-8" {
  if (!usage || usage.source === "unknown" || usage.percent <= 0) {
    return "circle-outline";
  }
  const step = Math.max(1, Math.min(8, Math.ceil(usage.percent / 12.5)));
  return `circle-slice-${step}` as ReturnType<typeof contextProgressIconName>;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${Number((value / 1_000_000).toFixed(1))}M`;
  }
  if (value >= 1_000) {
    return `${Number((value / 1_000).toFixed(1))}K`;
  }
  return String(value);
}
