// Settings usage dashboard, adapted from the legacy Graft Studio page.
// Quotas are live account snapshots; activity is recorded in this Graft instance.
import type { ServerProviderUsageSnapshot } from "@graft/contracts";
import {
  PROVIDER_USAGE_PROVIDERS,
  providerUsageDisplayName,
  providerUsageNeedsAuthDetail,
  selectVisibleProviderUsageSnapshots,
} from "@graft/shared/providerUsage";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAppSettings } from "~/appSettings";
import { ProviderIcon } from "~/components/ProviderIcon";
import { ProviderUsageLineList } from "~/components/ProviderUsageLineList";
import { SettingsCard } from "~/components/settings/SettingsPanelPrimitives";
import { useProviderUsageSummary } from "~/hooks/useProviderUsageSummary";
import { deriveProviderUsageDisplayRows } from "~/lib/providerUsageDisplay";
import { deriveAccountRateLimits, type ProviderRateLimit } from "~/lib/rateLimits";
import {
  fetchAllProviderUsage,
  serverAllProviderUsageQueryOptions,
  serverProfileTokenStatsQueryOptions,
  serverQueryKeys,
} from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import { useStore } from "~/store";
import { createAllThreadsSelector } from "~/storeSelectors";
import { UsageDashboard } from "./usage/UsageDashboard";

function quotaStatus(status: ServerProviderUsageSnapshot["status"]): string | null {
  switch (status) {
    case "needs-auth":
      return "Not signed in";
    case "unsupported":
      return "Unsupported";
    case "error":
      return "Unavailable";
    case "ok":
    case undefined:
      return null;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function ProviderQuotaCard({
  snapshot,
  threadRateLimits,
  codexHomePath,
}: {
  snapshot: ServerProviderUsageSnapshot;
  threadRateLimits: ReadonlyArray<ProviderRateLimit>;
  codexHomePath: string | null;
}) {
  const provider = snapshot.provider;
  const status = snapshot.status ?? "ok";
  const summary = useProviderUsageSummary({
    provider,
    threadRateLimits,
    codexHomePath,
    providerSnapshot: snapshot,
  });
  const rows = deriveProviderUsageDisplayRows(summary.rateLimits);
  return (
    <SettingsCard divided={false}>
      <div className="space-y-3 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
          <span className="flex items-center gap-1.5 font-medium">
            <ProviderIcon provider={provider} className="size-3.5 shrink-0" />
            {providerUsageDisplayName(provider)}
          </span>
          <span
            className={cn(
              "text-[10px] text-muted-foreground",
              status === "error" && "text-destructive",
            )}
          >
            {quotaStatus(status) ?? snapshot.planName}
          </span>
        </div>
        {status === "ok" ? (
          <>
            {rows.map((row) => (
              <div key={row.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>{row.label}</span>
                  <span className="tabular-nums">{row.remainingLabel} left</span>
                </div>
                <div
                  role="meter"
                  aria-label={`${providerUsageDisplayName(provider)} ${row.label} remaining`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={row.remainingPercent}
                  className="h-1 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-foreground/75"
                    style={{ width: `${row.remainingPercent}%` }}
                  />
                </div>
                {row.resetText ? (
                  <p className="text-[10px] text-muted-foreground">{row.resetText}</p>
                ) : null}
              </div>
            ))}
            {summary.usageLines.length > 0 ? (
              <ProviderUsageLineList lines={summary.usageLines} surface="popover" />
            ) : null}
            {summary.usageNotice ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {summary.usageNotice}
              </p>
            ) : null}
            {rows.length === 0 && summary.usageLines.length === 0 && !summary.usageNotice ? (
              <p className="text-[11px] text-muted-foreground">No quota reported yet.</p>
            ) : null}
          </>
        ) : (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {snapshot.detail ?? providerUsageNeedsAuthDetail(provider)}
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

function mergeProviderUsageRefresh(
  previous: readonly ServerProviderUsageSnapshot[] | undefined,
  next: readonly ServerProviderUsageSnapshot[],
): readonly ServerProviderUsageSnapshot[] {
  if (!previous) return next;
  const previousByProvider = new Map(previous.map((snapshot) => [snapshot.provider, snapshot]));
  const nextByProvider = new Map(next.map((snapshot) => [snapshot.provider, snapshot]));
  return PROVIDER_USAGE_PROVIDERS.map(
    (provider) => nextByProvider.get(provider) ?? previousByProvider.get(provider),
  ).filter((snapshot): snapshot is ServerProviderUsageSnapshot => snapshot !== undefined);
}

export function ProviderUsageSettingsPanel() {
  const queryClient = useQueryClient();
  const { settings } = useAppSettings();
  const threads = useStore(useMemo(() => createAllThreadsSelector(), []));
  const threadRateLimits = deriveAccountRateLimits(threads);
  const quotaQuery = useQuery(serverAllProviderUsageQueryOptions());
  const historyQuery = useQuery(serverProfileTokenStatsQueryOptions({ includeHistory: true }));
  const refreshMutation = useMutation({
    mutationFn: () => fetchAllProviderUsage({ forceRefresh: true }),
    onSuccess: (data) => {
      queryClient.setQueryData<readonly ServerProviderUsageSnapshot[]>(
        serverQueryKeys.allProviderUsage(),
        (previous) => mergeProviderUsageRefresh(previous, data),
      );
    },
  });
  const cards = selectVisibleProviderUsageSnapshots(quotaQuery.data ?? []);
  const quotaError = quotaQuery.isError || refreshMutation.isError;
  const refreshing = quotaQuery.isFetching || refreshMutation.isPending || historyQuery.isFetching;

  return (
    <UsageDashboard
      stats={historyQuery.data}
      loading={historyQuery.isPending}
      historyError={historyQuery.isError ? "Could not refresh usage history. Try again." : null}
      refreshing={refreshing}
      onRefresh={() => {
        refreshMutation.mutate();
        void historyQuery.refetch();
      }}
      quotas={
        <section aria-label="Provider quotas" className="space-y-2">
          {quotaError ? (
            <p role="alert" className="text-xs text-destructive">
              Could not refresh provider quotas.
              {cards.length > 0 ? " Showing the last loaded quotas." : " Try again."}
            </p>
          ) : null}
          {quotaQuery.isPending && !quotaQuery.data ? (
            <SettingsCard>
              <p role="status" className="px-4 py-5 text-xs text-muted-foreground">
                Loading provider quotas…
              </p>
            </SettingsCard>
          ) : cards.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((snapshot) => (
                <ProviderQuotaCard
                  key={snapshot.provider}
                  snapshot={snapshot}
                  threadRateLimits={threadRateLimits}
                  codexHomePath={settings.codexHomePath || null}
                />
              ))}
            </div>
          ) : !quotaError ? (
            <SettingsCard>
              <p className="px-4 py-5 text-xs text-muted-foreground">
                Sign in to a provider to see its remaining quota.
              </p>
            </SettingsCard>
          ) : null}
        </section>
      }
    />
  );
}
