import type { OrchestrationThreadActivity, ServerProviderUsageSnapshot } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { toMobileAllowance, toMobileContextUsage } from "./usage";

const now = "2026-09-14T12:00:00.000Z";
function activity(kind: string, payload: Record<string, unknown>, createdAt = now): OrchestrationThreadActivity {
  return { id: "usage", kind, payload, createdAt, tone: "info", summary: "Usage", turnId: null } as OrchestrationThreadActivity;
}
function provider(overrides: Partial<ServerProviderUsageSnapshot> = {}): ServerProviderUsageSnapshot {
  return { provider: "codex", updatedAt: now, limits: [], usageLines: [], source: "codex", status: "ok", ...overrides };
}

describe("mobile context usage", () => {
  it("uses the shared web occupancy and configured capacity", () => {
    expect(toMobileContextUsage([
      activity("context-window.configured", { maxTokens: 200000 }),
      activity("context-window.updated", { usedTokens: 50000, maxTokens: 100000 }),
    ])).toEqual({ percent: 25, tokensUsed: 50000, tokensMax: 200000, source: "measured" });
  });
  it("does not present capacity alone as measured zero usage", () => {
    expect(toMobileContextUsage([activity("context-window.configured", { maxTokens: 200000 })])).toBeUndefined();
  });
  it("invalidates context after compaction until a new measurement", () => {
    const previous = activity("context-window.updated", { usedTokens: 50000, maxTokens: 100000 });
    const compacted = activity("context-compaction", { state: "compacted" }, "2026-09-14T12:01:00.000Z");
    expect(toMobileContextUsage([previous, compacted])).toBeUndefined();
    expect(toMobileContextUsage([previous, compacted, activity("context-window.updated", { usedPercent: 10 }, "2026-09-14T12:02:00.000Z")]))
      .toEqual({ percent: 10, tokensUsed: 0, tokensMax: 0, source: "measured" });
  });
  it("does not invent a token ratio when only percentage is reported", () => {
    expect(toMobileContextUsage([activity("context-window.updated", { usedPercent: 42 })]))
      .toEqual({ percent: 42, tokensUsed: 0, tokensMax: 0, source: "measured" });
  });
  it("does not turn a percentage plus capacity into a fictitious zero token count", () => {
    expect(toMobileContextUsage([activity("context-window.updated", { usedPercent: 42, maxTokens: 200000 })]))
      .toEqual({ percent: 42, tokensUsed: 0, tokensMax: 0, source: "measured" });
  });
});

describe("mobile provider allowance", () => {
  it("converts used quotas to remaining while preserving reset times and distinct weekly scopes", () => {
    expect(toMobileAllowance("codex", provider({ planName: "Plus", limits: [
      { window: "5h", usedPercent: 25, windowDurationMins: 300 },
      { window: "Weekly", usedPercent: 100, windowDurationMins: 10080, resetsAt: now },
      { window: "Fable", usedPercent: 12, windowDurationMins: 10080 },
    ] }))).toMatchObject({ providerId: "codex", planName: "Plus", limits: [
      { label: "5h", remainingPercent: 75 },
      { label: "Weekly", remainingPercent: 0, resetsAt: now },
      { label: "Weekly · Fable", remainingPercent: 88 },
    ] });
  });
  it("keeps unsupported, sign-in-required, and stale results honest", () => {
    expect(toMobileAllowance("pi")).toEqual({ providerId: "pi", status: "unsupported", stale: false, limits: [] });
    expect(toMobileAllowance("codex", provider({ status: "needs-auth" }))).toMatchObject({ status: "needs-auth", limits: [] });
    expect(toMobileAllowance("codex", provider({ stale: true, limits: [{ window: "Weekly", usedPercent: 20 }] })))
      .toMatchObject({ stale: true, limits: [{ remainingPercent: 80 }] });
    expect(toMobileAllowance("codex", provider({ status: "error", limits: [{ window: "Weekly", usedPercent: 20 }] }))).toMatchObject({ stale: true });
  });
  it("omits unreported percentages and never invents a weekly window", () => {
    expect(toMobileAllowance("codex", provider({ limits: [{ window: "5h", usedPercent: 20 }, { window: "Weekly" }] })).limits)
      .toEqual([{ label: "5h", remainingPercent: 80 }]);
  });
});
