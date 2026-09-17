import "../index.css";

import type { DesktopBridge, LegacyGraftRuntimeStatus } from "@graft/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { LegacyGraftMigrationGate } from "./LegacyGraftMigrationGate";

const api = vi.hoisted(() => ({ getStatus: vi.fn(), retry: vi.fn() }));
vi.mock("../legacyGraft", () => ({
  getLegacyGraftStatus: api.getStatus,
  retryLegacyGraftImport: api.retry,
}));
const originalBridge = window.desktopBridge;
afterEach(() => {
  window.desktopBridge = originalBridge;
  vi.resetAllMocks();
});

describe("legacy import first launch", () => {
  it("opens a fresh desktop installation after the source check finishes", async () => {
    window.desktopBridge = {} as DesktopBridge;
    api.getStatus.mockResolvedValue({
      phase: "no-source",
      progress: null,
      error: null,
    } satisfies LegacyGraftRuntimeStatus);
    const screen = await render(
      <LegacyGraftMigrationGate>
        <p>Your workspace</p>
      </LegacyGraftMigrationGate>,
    );
    await expect.element(screen.getByText("Your workspace")).toBeVisible();
  });

  it("holds the workspace on import failure and releases it after successful retry", async () => {
    window.desktopBridge = {} as DesktopBridge;
    api.getStatus.mockResolvedValue({
      phase: "failed",
      progress: null,
      error: "Not enough space for a backup.",
    } satisfies LegacyGraftRuntimeStatus);
    api.retry.mockImplementation(async () => {
      api.getStatus.mockResolvedValue({
        phase: "complete",
        progress: null,
        error: null,
      } satisfies LegacyGraftRuntimeStatus);
    });
    const screen = await render(
      <LegacyGraftMigrationGate>
        <p>Your workspace</p>
      </LegacyGraftMigrationGate>,
    );
    await expect
      .element(screen.getByRole("heading", { name: "Your history needs attention" }))
      .toBeVisible();
    await expect.element(screen.getByText("Your workspace")).not.toBeInTheDocument();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Not enough space");
    await screen.getByRole("button", { name: "Retry import" }).click();
    await expect.element(screen.getByText("Your workspace")).toBeVisible();
    expect(api.retry).toHaveBeenCalledOnce();
  });

  it("does not apply desktop history import policy to browser clients", async () => {
    window.desktopBridge = undefined;
    const screen = await render(
      <LegacyGraftMigrationGate>
        <p>Browser workspace</p>
      </LegacyGraftMigrationGate>,
    );
    await expect.element(screen.getByText("Browser workspace")).toBeVisible();
    expect(api.getStatus).not.toHaveBeenCalled();
  });
});
