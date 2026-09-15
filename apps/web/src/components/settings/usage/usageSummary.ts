import type { ProfileTokenDayUsage } from "@graft/contracts";
import { providerUsageDisplayName } from "@graft/shared/providerUsage";

export type UsageProvider = ProfileTokenDayUsage["provider"];

export const USAGE_WINDOWS = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

// Stable across filters and themes, including providers absent from the window.
export const USAGE_PROVIDER_COLORS: Record<UsageProvider, string> = {
  claudeAgent: "var(--color-orange-500)",
  codex: "var(--color-violet-500)",
  cursor: "var(--color-foreground)",
  opencode: "var(--color-cyan-500)",
  antigravity: "var(--color-blue-500)",
  grok: "var(--color-rose-500)",
  droid: "var(--color-emerald-500)",
  pi: "var(--color-amber-500)",
  devin: "var(--color-pink-500)",
  unknown: "var(--color-muted-foreground)",
};

export function usageProviderName(provider: UsageProvider): string {
  return provider === "unknown" ? "Unknown provider" : providerUsageDisplayName(provider);
}

const tokenFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const dayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function formatUsageTokens(value: number): string {
  return tokenFormatter.format(value);
}

// Calendar keys already use the server's requested offset. UTC arithmetic on
// those keys avoids local DST changes adding or dropping a day from a range.
export function usageDayOffset(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function formatUsageDay(day: string): string {
  return dayFormatter.format(new Date(`${day}T00:00:00Z`));
}

export interface UsageDay {
  day: string;
  tokens: number;
  byProvider: Map<UsageProvider, number>;
}

export function summarizeUsage(
  rows: readonly ProfileTokenDayUsage[],
  today: string,
  windowDays: number,
) {
  const days: UsageDay[] = Array.from({ length: windowDays }, (_, index) => ({
    day: usageDayOffset(today, index + 1 - windowDays),
    tokens: 0,
    byProvider: new Map<UsageProvider, number>(),
  }));
  const byDay = new Map(days.map((day) => [day.day, day]));
  const byProvider = new Map<UsageProvider, number>();
  const byModel = new Map<string, Omit<ProfileTokenDayUsage, "day">>();
  let totalTokens = 0;
  for (const row of rows) {
    const day = byDay.get(row.day);
    if (!day || !Number.isFinite(row.tokens) || row.tokens <= 0) continue;
    day.tokens += row.tokens;
    day.byProvider.set(row.provider, (day.byProvider.get(row.provider) ?? 0) + row.tokens);
    byProvider.set(row.provider, (byProvider.get(row.provider) ?? 0) + row.tokens);
    const key = `${row.provider}\u0000${row.model}`;
    const previous = byModel.get(key);
    byModel.set(key, {
      provider: row.provider,
      model: row.model,
      tokens: (previous?.tokens ?? 0) + row.tokens,
    });
    totalTokens += row.tokens;
  }
  const activeDays = days.filter((day) => day.tokens > 0).length;
  const peakDay = days.reduce<UsageDay | null>(
    (peak, day) => (day.tokens > (peak?.tokens ?? 0) ? day : peak),
    null,
  );
  return {
    days,
    totalTokens,
    activeDays,
    dailyAverage: activeDays > 0 ? totalTokens / activeDays : 0,
    peakDay,
    providers: [...byProvider]
      .map(([provider, tokens]) => ({ provider, tokens }))
      .toSorted((a, b) => b.tokens - a.tokens || a.provider.localeCompare(b.provider)),
    models: [...byModel.values()].toSorted(
      (a, b) =>
        b.tokens - a.tokens ||
        a.provider.localeCompare(b.provider) ||
        a.model.localeCompare(b.model),
    ),
  };
}

export type UsageSummary = ReturnType<typeof summarizeUsage>;
