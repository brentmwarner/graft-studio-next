import { describe, expect, it } from "vitest";

import { contextUsageAccessibilityLabel, contextUsageDetail } from "./contextUsage";

describe("context usage presentation", () => {
  it("formats measured usage for assistive text and the detail dialog", () => {
    const usage = {
      percent: 42,
      tokensUsed: 84_000,
      tokensMax: 200_000,
      source: "measured" as const,
    };

    expect(contextUsageAccessibilityLabel(usage)).toBe("Context: 42% used");
    expect(contextUsageDetail(usage)).toBe("42% used · 84K of 200K tokens");
  });

  it("keeps unreported context honest", () => {
    const usage = {
      percent: 0,
      tokensUsed: 0,
      tokensMax: 200_000,
      source: "unknown" as const,
    };

    expect(contextUsageAccessibilityLabel(usage)).toBe("Context usage unavailable");
    expect(contextUsageDetail(usage)).toContain("does not report");
  });
});
