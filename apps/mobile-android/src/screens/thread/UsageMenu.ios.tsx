import type { GraftContextUsage, GraftThreadUsage } from "@graft/mobile-contract";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";

import { GatewayError } from "../../api/gateway";
import { AnchoredMenu, MenuCaption, MenuItem } from "../../components/AnchoredMenu";
import { useGraftPalette } from "../../theme/tokens";
import { contextUsageTokenDetail } from "./contextUsage";
import { displayName } from "./displayName";

function resetLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  if (date.getTime() <= Date.now()) return "Awaiting updated allowance";
  return `Resets ${date.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

function UsageMeter({
  title,
  value,
  detail,
  percent,
}: {
  readonly title: string;
  readonly value: string;
  readonly detail?: string;
  readonly percent?: number;
}) {
  const palette = useGraftPalette();
  const normalized =
    percent !== undefined && Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
  return (
    <View style={styles.usageRow}>
      <View style={styles.usageHeading}>
        <Text style={[styles.usageTitle, { color: palette.foregroundMuted }]}>{title}</Text>
        <Text style={[styles.usageValue, { color: palette.foreground }]}>{value}</Text>
      </View>
      {normalized === null ? null : (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.progressTrack, { backgroundColor: palette.muted }]}
        >
          <View
            style={[
              styles.progressFill,
              { backgroundColor: palette.foregroundMuted, width: `${normalized}%` },
            ]}
          />
        </View>
      )}
      {detail ? (
        <Text style={[styles.usageDetail, { color: palette.foregroundSubtle }]}>{detail}</Text>
      ) : null}
    </View>
  );
}

export function UsageMenu({
  threadId,
  contextUsage,
  onLoadUsage,
  trigger,
}: {
  readonly threadId: string;
  readonly contextUsage: GraftContextUsage | undefined;
  readonly onLoadUsage: (threadId: string) => Promise<GraftThreadUsage>;
  readonly trigger: (open: () => void) => ReactElement;
}) {
  const palette = useGraftPalette();
  const [usage, setUsage] = useState<GraftThreadUsage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  async function load() {
    const request = ++generation.current;
    setUsage(undefined);
    setError(undefined);
    setLoading(true);
    try {
      const result = await onLoadUsage(threadId);
      if (request === generation.current) setUsage(result);
    } catch (cause) {
      if (request === generation.current) {
        setError(
          cause instanceof GatewayError && cause.status === 404
            ? "Account usage isn’t available on this host yet."
            : "Couldn’t load account usage.",
        );
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }

  const context = usage ? usage.contextUsage : contextUsage;
  const measured = context?.source === "measured";
  const allowance = usage?.allowance;
  return (
    <AnchoredMenu
      trigger={trigger}
      onOpenChange={(open) => {
        if (open) void load();
        else generation.current += 1;
      }}
    >
      {() => (
        <>
          <UsageMeter
            title="Context window"
            value={measured ? `${context.percent}% used` : "Not reported"}
            percent={measured ? context.percent : undefined}
            detail={
              measured
                ? contextUsageTokenDetail(context)
                : "Context measurements appear when the provider reports them."
            }
          />
          <View style={[styles.separator, { backgroundColor: palette.border }]} />
          <MenuCaption>
            {allowance
              ? `${displayName(allowance.providerId)} account${allowance.planName ? ` · ${allowance.planName}` : ""}`
              : "Account usage"}
          </MenuCaption>
          {loading ? <MenuCaption>Checking allowance…</MenuCaption> : null}
          {allowance?.limits.map((limit, index) => (
            <UsageMeter
              key={`${limit.label}:${index}`}
              title={limit.label === "5h" ? "5-hour limit" : limit.label}
              value={`${Math.round(limit.remainingPercent)}% remaining`}
              percent={limit.remainingPercent}
              detail={limit.resetsAt ? resetLabel(limit.resetsAt) : undefined}
            />
          ))}
          {allowance?.stale ? (
            <MenuCaption>{`Last reported${allowance.updatedAt ? ` ${new Date(allowance.updatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""} · may be out of date`}</MenuCaption>
          ) : null}
          {allowance && allowance.limits.length === 0 ? (
            <MenuCaption>
              {allowance.status === "needs-auth"
                ? "Sign in to the provider on your host to see allowance."
                : allowance.status === "error"
                  ? "Provider usage is temporarily unavailable."
                  : "This provider doesn’t report account allowance."}
            </MenuCaption>
          ) : null}
          {error ? (
            <>
              <MenuCaption>{error}</MenuCaption>
              <MenuItem label="Try again" onPress={() => void load()} />
            </>
          ) : null}
        </>
      )}
    </AnchoredMenu>
  );
}

const styles = StyleSheet.create({
  usageRow: { gap: 10, paddingHorizontal: 12, paddingVertical: 12 },
  usageHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  usageTitle: { flex: 1, fontSize: 12, fontWeight: "500", lineHeight: 16 },
  usageValue: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    textAlign: "right",
  },
  progressTrack: { borderRadius: 3, height: 6, overflow: "hidden" },
  progressFill: { borderRadius: 3, height: 6 },
  usageDetail: { fontSize: 12, lineHeight: 17 },
  separator: { height: StyleSheet.hairlineWidth, marginHorizontal: 12, marginVertical: 4 },
});
