import type { GraftContextUsage, GraftProviderAllowance } from "@graft/mobile-contract";
import type { OrchestrationThreadActivity, ServerProviderUsageSnapshot } from "@graft/contracts";
import { deriveLatestContextWindowState } from "@graft/shared/contextWindow";

export function toMobileContextUsage(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): GraftContextUsage | undefined {
  const { snapshot } = deriveLatestContextWindowState(activities);
  // A configured capacity alone is not a measured empty context window.
  if (!snapshot || snapshot.usedPercentage === null) return undefined;
  const measurement = activities.findLast(
    (activity) =>
      activity.kind === "context-window.updated" && activity.createdAt === snapshot.updatedAt,
  );
  if (!measurement) return undefined;
  const payload = measurement.payload;
  const rawTokens =
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "usedTokens" in payload
      ? payload.usedTokens
      : undefined;
  const hasTokenCount =
    typeof rawTokens === "number" && Number.isFinite(rawTokens) && rawTokens >= 0;
  return {
    percent: Math.round(Math.max(0, Math.min(100, snapshot.usedPercentage))),
    tokensUsed: Math.max(0, Math.round(snapshot.usedTokens)),
    tokensMax: hasTokenCount ? Math.max(0, Math.round(snapshot.maxTokens ?? 0)) : 0,
    source: "measured",
  };
}

export function toMobileAllowance(
  providerId: string,
  snapshot?: ServerProviderUsageSnapshot,
): GraftProviderAllowance {
  if (!snapshot) return { providerId, status: "unsupported", stale: false, limits: [] };
  const status = snapshot.status ?? "ok";
  return {
    providerId,
    status,
    updatedAt: snapshot.updatedAt,
    stale: (snapshot.stale ?? false) || status !== "ok",
    ...(snapshot.planName ? { planName: snapshot.planName } : {}),
    limits: snapshot.limits.flatMap((limit) => {
      if (limit.usedPercent === undefined || !Number.isFinite(limit.usedPercent)) return [];
      const weekly = limit.windowDurationMins === 7 * 24 * 60;
      // Preserve provider-specific weekly sublimits (e.g. a particular model).
      const label =
        weekly && !/week|7.day/i.test(limit.window) ? `Weekly · ${limit.window}` : limit.window;
      return [
        {
          label,
          remainingPercent: Math.max(0, Math.min(100, 100 - limit.usedPercent)),
          ...(limit.resetsAt ? { resetsAt: limit.resetsAt } : {}),
        },
      ];
    }),
  };
}
