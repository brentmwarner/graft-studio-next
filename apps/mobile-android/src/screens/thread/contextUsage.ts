import type { GraftContextUsage } from "@graft/mobile-contract";

export function contextUsageAccessibilityLabel(usage: GraftContextUsage | undefined): string {
  return usage?.source === "measured"
    ? `Context: ${usage.percent}% used`
    : "Context usage unavailable";
}

export function contextUsageDetail(usage: GraftContextUsage | undefined): string {
  if (!usage || usage.source === "unknown") {
    return "This provider does not report context-window usage yet.";
  }
  if (usage.tokensMax <= 0) {
    return `${usage.percent}% of the context window is used.`;
  }
  return `${usage.percent}% used · ${contextUsageTokenDetail(usage)}`;
}

export function contextUsageTokenDetail(usage: GraftContextUsage | undefined): string | undefined {
  if (!usage || usage.source !== "measured" || usage.tokensMax <= 0) return undefined;
  return `${formatTokenCount(usage.tokensUsed)} of ${formatTokenCount(usage.tokensMax)} tokens`;
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
