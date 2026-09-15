import type { ProfileTokenStats } from "@synara/contracts";
import { useMemo, useState, type ReactNode } from "react";

import { ProviderIcon } from "~/components/ProviderIcon";
import { ActivityHeatmap } from "~/components/profile/ActivityHeatmap";
import { SettingsCard } from "~/components/settings/SettingsPanelPrimitives";
import { Button } from "~/components/ui/button";
import { RotateCcwIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { UsageChart } from "./UsageChart";
import {
  formatUsageDay,
  formatUsageTokens,
  summarizeUsage,
  USAGE_WINDOWS,
  usageProviderName,
  type UsageProvider,
  type UsageSummary,
} from "./usageSummary";

const EMPTY_DAYS: NonNullable<ProfileTokenStats["history"]>["days"] = [];
const HEATMAP_CLASSES = [
  "bg-muted/60",
  "bg-foreground/10",
  "bg-foreground/25",
  "bg-foreground/50",
  "bg-foreground/90",
];
const LABEL_CLASS = "text-[11px] uppercase tracking-wide text-muted-foreground";

function ProviderLabel({ provider }: { provider: UsageProvider }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {provider !== "unknown" ? (
        <ProviderIcon provider={provider} className="size-3.5 shrink-0" />
      ) : null}
      <span className="truncate">{usageProviderName(provider)}</span>
    </span>
  );
}

function SegmentButton({
  children,
  selected,
  onClick,
}: {
  children: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 motion-reduce:transition-none",
        selected
          ? "bg-background text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-base font-medium tabular-nums text-foreground">
        {value}
        <p className="mt-0.5 text-[10px] font-normal text-muted-foreground">{detail}</p>
      </dd>
    </div>
  );
}

function UsageBreakdown({ summary }: { summary: UsageSummary }) {
  const [breakdown, setBreakdown] = useState<"model" | "day">("model");
  // Keep every day available (including zero days) so the chart has a readable,
  // keyboard-accessible equivalent. The container scrolls for longer ranges.
  const days = summary.days.toReversed();
  return (
    <section className="space-y-2" aria-label="Usage breakdown">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className={LABEL_CLASS}>Breakdown</h2>
        <div role="group" aria-label="Breakdown view" className="flex rounded-lg bg-muted/60 p-0.5">
          <SegmentButton selected={breakdown === "model"} onClick={() => setBreakdown("model")}>
            Model
          </SegmentButton>
          <SegmentButton selected={breakdown === "day"} onClick={() => setBreakdown("day")}>
            Day
          </SegmentButton>
        </div>
      </div>
      <SettingsCard divided={false}>
        <div
          className="max-h-80 overflow-auto px-4"
          tabIndex={0}
          role="region"
          aria-label={`${breakdown === "model" ? "Model" : "Daily"} token usage`}
        >
          <table className="w-full text-left text-xs" data-testid={`usage-${breakdown}-table`}>
            <caption className="sr-only">
              Tokens processed in the selected range, by {breakdown}
            </caption>
            <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="py-3 pr-4 font-medium">
                  {breakdown === "model" ? "Model" : "Day"}
                </th>
                {breakdown === "model" ? (
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Share
                  </th>
                ) : (
                  summary.providers.map(({ provider }) => (
                    <th
                      key={provider}
                      scope="col"
                      className="px-3 py-3 text-right font-medium whitespace-nowrap"
                    >
                      {usageProviderName(provider)}
                    </th>
                  ))
                )}
                <th scope="col" className="py-3 pl-3 text-right font-medium">
                  Tokens
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.totalTokens === 0 ? (
                <tr>
                  <td
                    colSpan={breakdown === "model" ? 3 : summary.providers.length + 2}
                    className="border-t border-border py-8 text-center text-muted-foreground"
                  >
                    No recorded tokens in this range.
                  </td>
                </tr>
              ) : breakdown === "model" ? (
                summary.models.map((model) => (
                  <tr key={`${model.provider}:${model.model}`} className="border-t border-border">
                    <th scope="row" className="py-3 pr-4 font-normal">
                      <span className="flex items-center gap-2">
                        {model.provider !== "unknown" ? (
                          <ProviderIcon provider={model.provider} className="size-3.5 shrink-0" />
                        ) : null}
                        <span className="min-w-0 break-all font-mono text-[11px]">
                          {model.model}
                        </span>
                        <span className="sr-only"> ({usageProviderName(model.provider)})</span>
                      </span>
                    </th>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {((model.tokens / summary.totalTokens) * 100).toFixed(1)}%
                    </td>
                    <td
                      className="py-3 pl-3 text-right tabular-nums"
                      title={model.tokens.toLocaleString()}
                    >
                      {formatUsageTokens(model.tokens)}
                    </td>
                  </tr>
                ))
              ) : (
                days.map((day) => (
                  <tr key={day.day} className="border-t border-border">
                    <th scope="row" className="py-3 pr-4 font-normal whitespace-nowrap">
                      {formatUsageDay(day.day)}
                    </th>
                    {summary.providers.map(({ provider }) => (
                      <td
                        key={provider}
                        className="px-3 py-3 text-right tabular-nums"
                        title={(day.byProvider.get(provider) ?? 0).toLocaleString()}
                      >
                        {formatUsageTokens(day.byProvider.get(provider) ?? 0)}
                      </td>
                    ))}
                    <td
                      className="py-3 pl-3 text-right tabular-nums"
                      title={day.tokens.toLocaleString()}
                    >
                      {formatUsageTokens(day.tokens)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SettingsCard>
      <p className="px-1 pt-1 text-[11px] text-muted-foreground">
        Average {formatUsageTokens(summary.dailyAverage)} tokens on active days.
      </p>
    </section>
  );
}

export function UsageDashboard({
  stats,
  loading,
  historyError,
  refreshing,
  onRefresh,
  quotas,
}: {
  stats: ProfileTokenStats | undefined;
  loading: boolean;
  historyError: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  quotas: ReactNode;
}) {
  const [windowDays, setWindowDays] = useState(30);
  const history = stats?.history;
  const now = new Date();
  const today =
    history?.today ??
    new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const rows = history?.days ?? EMPTY_DAYS;
  const summary = useMemo(() => summarizeUsage(rows, today, windowDays), [rows, today, windowDays]);
  const ready = history !== undefined;
  const unavailable = stats?.unavailableProviders ?? [];
  const historyNotice =
    historyError ??
    (!loading && !ready
      ? "Usage history is unavailable. Update the connected server and refresh to load it."
      : null);

  return (
    <div className="space-y-5" data-testid="usage-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-foreground">Usage</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatUsageDay(summary.days[0]!.day)} to {formatUsageDay(today)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Usage time range"
            className="flex rounded-lg bg-muted/60 p-0.5"
          >
            {USAGE_WINDOWS.map((window) => (
              <SegmentButton
                key={window.days}
                selected={windowDays === window.days}
                onClick={() => setWindowDays(window.days)}
              >
                {window.label}
              </SegmentButton>
            ))}
          </div>
          <Button
            size="xs"
            variant="ghost"
            disabled={refreshing}
            onClick={onRefresh}
            aria-label="Refresh usage"
          >
            <RotateCcwIcon className={cn("size-3.5", refreshing && "motion-safe:animate-spin")} />
            Refresh
          </Button>
        </div>
      </header>

      {quotas}
      {historyNotice ? (
        <p role="alert" className="text-xs text-destructive">
          {historyNotice}
          {ready ? " Showing the last loaded history." : ""}
        </p>
      ) : null}

      <SettingsCard>
        <div className="grid gap-5 p-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <div>
            <h2 className={LABEL_CLASS}>Processed tokens</h2>
            <p
              className="mt-1 text-3xl font-medium tabular-nums tracking-tight text-foreground"
              data-testid="usage-hero"
            >
              {ready ? formatUsageTokens(summary.totalTokens) : "—"}
            </p>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {ready
                ? `Recorded in Synara across ${summary.activeDays} active ${summary.activeDays === 1 ? "day" : "days"}.`
                : loading
                  ? "Loading usage history…"
                  : "History unavailable"}
            </p>
          </div>
          {ready && summary.providers.length > 0 ? (
            <div className="space-y-3">
              {summary.providers.map(({ provider, tokens }) => (
                <div key={provider} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <ProviderLabel provider={provider} />
                    <span className="tabular-nums text-muted-foreground">
                      {formatUsageTokens(tokens)}
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full origin-left rounded-full bg-foreground"
                      style={{ width: `${(tokens / summary.totalTokens) * 100}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {((tokens / summary.totalTokens) * 100).toFixed(1)}% of tokens
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="p-4">
          <h2 className={cn(LABEL_CLASS, "mb-4")}>Daily processed tokens</h2>
          {ready ? (
            <UsageChart summary={summary} />
          ) : (
            <div
              className="flex h-56 items-center justify-center text-xs text-muted-foreground"
              role="status"
            >
              {loading ? "Loading activity…" : "Activity unavailable"}
            </div>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-5 p-4 sm:grid-cols-4">
          <Metric
            label="Processed tokens"
            value={ready ? formatUsageTokens(summary.totalTokens) : "—"}
            detail="selected range"
          />
          <Metric
            label="Active days"
            value={ready ? String(summary.activeDays) : "—"}
            detail={`of ${windowDays} ${windowDays === 1 ? "day" : "days"}`}
          />
          <Metric
            label="Daily average"
            value={ready ? formatUsageTokens(summary.dailyAverage) : "—"}
            detail="per active day"
          />
          <Metric
            label="Peak day"
            value={ready ? formatUsageTokens(summary.peakDay?.tokens ?? 0) : "—"}
            detail={summary.peakDay ? formatUsageDay(summary.peakDay.day) : "no activity"}
          />
        </dl>
      </SettingsCard>

      <SettingsCard divided={false}>
        <section className="p-4" aria-label="Token activity heatmap">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">
              Activity{" "}
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                Past 6 months
              </span>
            </h2>
            <div
              className="flex items-center gap-1 text-[10px] text-muted-foreground"
              aria-hidden="true"
            >
              Less{" "}
              {HEATMAP_CLASSES.map((color) => (
                <span key={color} className={cn("size-2 rounded-xs", color)} />
              ))}{" "}
              More
            </div>
          </div>
          {stats ? (
            <ActivityHeatmap
              cells={stats.heatmap.slice(-182)}
              fill
              showMonths
              tooltip
              tooltipUnit="tokens"
              radius={3}
              intensityClasses={HEATMAP_CLASSES}
            />
          ) : (
            <p className="py-10 text-center text-xs text-muted-foreground">
              {loading ? "Loading activity…" : "Activity unavailable"}
            </p>
          )}
        </section>
      </SettingsCard>

      {ready ? <UsageBreakdown summary={summary} /> : null}
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        History includes tokens reported by tasks in this Synara instance. Provider quotas include
        account-wide usage.
        {unavailable.length > 0
          ? ` Token totals are unavailable for ${unavailable.map(usageProviderName).join(", ")}.`
          : ""}
      </p>
    </div>
  );
}
