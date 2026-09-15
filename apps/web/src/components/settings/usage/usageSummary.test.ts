import { describe, expect, it } from "vitest";
import type { ProfileTokenDayUsage } from "@synara/contracts";

import { summarizeUsage, usageDayOffset } from "./usageSummary";

describe("usage dashboard summaries", () => {
  const rows: ProfileTokenDayUsage[] = [
    { day: "2026-09-08", provider: "codex", model: "shared-model", tokens: 500 },
    { day: "2026-09-09", provider: "codex", model: "shared-model", tokens: 100 },
    { day: "2026-09-15", provider: "codex", model: "shared-model", tokens: 200 },
    { day: "2026-09-15", provider: "cursor", model: "shared-model", tokens: 700 },
    { day: "2026-09-15", provider: "unknown", model: "unknown", tokens: 100 },
    { day: "2026-09-16", provider: "codex", model: "shared-model", tokens: 9000 },
  ];

  it("filters every metric to the inclusive calendar range and fills inactive days", () => {
    const summary = summarizeUsage(rows, "2026-09-15", 7);
    expect(summary.days.map((day) => day.day)).toEqual([
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
      "2026-09-14",
      "2026-09-15",
    ]);
    expect(summary.totalTokens).toBe(1100);
    expect(summary.activeDays).toBe(2);
    expect(summary.dailyAverage).toBe(550);
    expect(summary.peakDay).toMatchObject({ day: "2026-09-15", tokens: 1000 });
    expect(summary.days[1]?.tokens).toBe(0);
    expect(summary.models).toEqual([
      { provider: "cursor", model: "shared-model", tokens: 700 },
      { provider: "codex", model: "shared-model", tokens: 300 },
      { provider: "unknown", model: "unknown", tokens: 100 },
    ]);
    expect(summary.providers.reduce((total, provider) => total + provider.tokens, 0)).toBe(1100);
    expect(summary.days.reduce((total, day) => total + day.tokens, 0)).toBe(1100);
  });

  it("handles Today and empty windows without inventing activity or invalid shares", () => {
    expect(summarizeUsage(rows, "2026-09-15", 1).totalTokens).toBe(1000);
    const empty = summarizeUsage(rows, "2026-09-01", 30);
    expect(empty.totalTokens).toBe(0);
    expect(empty.dailyAverage).toBe(0);
    expect(empty.peakDay).toBeNull();
    expect(empty.models).toEqual([]);
    expect(empty.providers).toEqual([]);
  });

  it("keeps calendar ranges stable across DST and year boundaries", () => {
    expect(usageDayOffset("2026-03-09", -1)).toBe("2026-03-08");
    expect(usageDayOffset("2026-11-02", -1)).toBe("2026-11-01");
    expect(usageDayOffset("2026-01-01", -1)).toBe("2025-12-31");
    expect(usageDayOffset("2024-03-01", -1)).toBe("2024-02-29");
  });
});
