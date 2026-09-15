import "../../index.css";

import type { ProfileTokenStats, ServerProviderUsageSnapshot } from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ProviderUsageSettingsPanel } from "./ProviderUsageSettingsPanel";
import { serverProfileTokenStatsQueryOptions, serverQueryKeys } from "~/lib/serverReactQuery";

const api = vi.hoisted(() => ({ quotas: vi.fn(), history: vi.fn() }));
vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({
    server: { listProviderUsage: api.quotas },
    stats: { getProfileTokenStats: api.history },
  }),
}));
vi.mock("~/appSettings", () => ({ useAppSettings: () => ({ settings: { codexHomePath: "" } }) }));
vi.mock("~/store", () => ({ useStore: () => [] }));

const stats: ProfileTokenStats = {
  available: true,
  lifetimeTotalTokens: 9000,
  peakDay: "2026-08-20",
  peakDayTokens: 7000,
  providers: ["codex", "claudeAgent"],
  unavailableProviders: ["pi"],
  topProvider: "codex",
  topProviderPercent: 90,
  models: [],
  heatmapMetric: "tokens",
  heatmap: [],
  history: {
    today: "2026-09-15",
    days: [
      { day: "2026-08-20", provider: "codex", model: "model-a", tokens: 7000 },
      { day: "2026-09-10", provider: "codex", model: "model-a", tokens: 500 },
      { day: "2026-09-15", provider: "claudeAgent", model: "model-b", tokens: 1500 },
    ],
  },
};
const quotas: ServerProviderUsageSnapshot[] = ["codex", "claudeAgent"].map((provider) => ({
  provider: provider as "codex" | "claudeAgent",
  status: "ok",
  source: "test",
  updatedAt: "2026-09-15T12:00:00Z",
  planName: "Pro",
  usageLines: [],
  limits: [{ window: "5h", usedPercent: 25 }],
}));
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.quotas.mockReset().mockResolvedValue(quotas);
  api.history.mockReset().mockResolvedValue(stats);
});
afterEach(() => {
  client.clear();
});

function mount() {
  return render(
    <QueryClientProvider client={client}>
      <ProviderUsageSettingsPanel />
    </QueryClientProvider>,
  );
}

describe("Usage dashboard", () => {
  it("changes totals, chart and model/day breakdown together for each range", async () => {
    const screen = await mount();
    await expect.element(screen.getByTestId("usage-hero")).toHaveTextContent("9K");
    expect(api.history).toHaveBeenCalledWith(expect.objectContaining({ includeHistory: true }));
    await screen.getByRole("button", { name: "7 days", exact: true }).click();
    await expect.element(screen.getByTestId("usage-hero")).toHaveTextContent("2K");
    await expect
      .element(screen.getByRole("img", { name: /Daily processed tokens/ }))
      .toHaveAccessibleName(/2K tokens total/);
    await expect.element(screen.getByTestId("usage-model-table")).toHaveTextContent("75.0%");
    await screen.getByRole("button", { name: "Day", exact: true }).click();
    await expect.element(screen.getByTestId("usage-day-table")).toHaveTextContent("Sep 15");
    await expect.element(screen.getByTestId("usage-day-table")).not.toHaveTextContent("Aug 20");
    await screen.getByRole("button", { name: "Today", exact: true }).click();
    await expect.element(screen.getByTestId("usage-hero")).toHaveTextContent("1.5K");
    await expect
      .element(screen.getByRole("meter", { name: "Codex 5h remaining" }))
      .toHaveAttribute("aria-valuenow", "75");
    await screen.unmount();
  });

  it("refreshes both sources, preserves omitted providers and clears stale quotas after sign-out", async () => {
    const screen = await mount();
    await expect.element(screen.getByTestId("usage-hero")).toHaveTextContent("9K");
    api.quotas.mockResolvedValueOnce([
      { ...quotas[0], status: "needs-auth", limits: [], detail: "Sign in again." },
    ]);
    await screen.getByRole("button", { name: "Refresh usage" }).click();
    await expect
      .element(screen.getByRole("meter", { name: "Codex 5h remaining" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("meter", { name: "Claude 5h remaining" }))
      .toHaveAttribute("aria-valuenow", "75");
    expect(api.quotas).toHaveBeenLastCalledWith({ forceRefresh: true });
    expect(api.history).toHaveBeenCalledTimes(2);
    await screen.unmount();
  });

  it("keeps previous data on refresh failure and recovers on retry", async () => {
    const screen = await mount();
    await expect.element(screen.getByTestId("usage-hero")).toHaveTextContent("9K");
    api.quotas.mockRejectedValueOnce(new Error("offline"));
    api.history.mockRejectedValueOnce(new Error("offline"));
    await screen.getByRole("button", { name: "Refresh usage" }).click();
    await expect.element(screen.getByText(/Could not refresh usage history/)).toBeVisible();
    await expect.element(screen.getByText(/Could not refresh provider quotas/)).toBeVisible();
    await expect.element(screen.getByTestId("usage-hero")).toHaveTextContent("9K");
    await screen.getByRole("button", { name: "Refresh usage" }).click();
    await expect
      .element(screen.getByText(/Could not refresh usage history/))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText(/Could not refresh provider quotas/))
      .not.toBeInTheDocument();
    await screen.unmount();
  });

  it("distinguishes empty history from an older server without history", async () => {
    api.history.mockResolvedValueOnce({
      ...stats,
      available: false,
      history: { today: "2026-09-15", days: [] },
    });
    const screen = await mount();
    await expect.element(screen.getByTestId("usage-hero")).toHaveTextContent("0");
    await expect
      .element(screen.getByTestId("usage-model-table"))
      .toHaveTextContent("No recorded tokens");
    api.history.mockResolvedValueOnce({ ...stats, history: undefined });
    await screen.getByRole("button", { name: "Refresh usage" }).click();
    await expect.element(screen.getByText(/Update the connected server/)).toBeVisible();
    await expect.element(screen.getByTestId("usage-hero")).toHaveTextContent("—");
    await screen.unmount();
  });

  it("does not reuse a cached Profile payload without daily history", async () => {
    client.setQueryData(serverQueryKeys.profileTokenStats(-new Date().getTimezoneOffset()), {
      ...stats,
      history: undefined,
    });
    expect(serverProfileTokenStatsQueryOptions({ includeHistory: true }).queryKey).not.toEqual(
      serverProfileTokenStatsQueryOptions().queryKey,
    );
    const screen = await mount();
    await expect.element(screen.getByTestId("usage-hero")).toHaveTextContent("9K");
    expect(api.history).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });
});
