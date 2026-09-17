import "../index.css";

import type { DesktopBridge, GraftAccountState } from "@graft/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { GraftAccountGate } from "./GraftAccountGate";

const signedOut: GraftAccountState = { status: "signed-out", account: null, issue: null };
const signedIn: GraftAccountState = {
  status: "signed-in",
  account: { accountId: "existing", email: "user@example.test" },
  issue: null,
};
function harness() {
  const listeners = new Set<(state: GraftAccountState) => void>();
  const bridge: NonNullable<DesktopBridge["account"]> = {
    getState: async () => signedOut,
    signIn: vi.fn(async () => ({ ...signedOut, status: "signing-in" as const })),
    cancelSignIn: async () => signedOut,
    signOut: async () => signedOut,
    refresh: async () => signedIn,
    onState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    bridge,
    emit: (state: GraftAccountState) => {
      for (const listener of listeners) listener(state);
    },
  };
}
function Workspace() {
  const [value, setValue] = useState(0);
  return <button onClick={() => setValue(value + 1)}>Local work {value}</button>;
}

describe("Graft desktop account gate", () => {
  it("requires verified sign-in and preserves the mounted workspace throughout offline grace", async () => {
    const { bridge, emit } = harness();
    const screen = await render(
      <GraftAccountGate bridge={bridge}>
        <Workspace />
      </GraftAccountGate>,
    );
    await expect.element(screen.getByText("Welcome to Graft")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Local work 0" }))
      .not.toBeInTheDocument();
    emit(signedIn);
    await screen.getByRole("button", { name: "Local work 0" }).click();
    emit({ ...signedIn, issue: "service-unavailable" });
    await expect.element(screen.getByRole("button", { name: "Local work 1" })).toBeVisible();
    await expect.element(screen.getByRole("status")).toHaveTextContent("Graft is offline");
    emit({ ...signedOut, issue: "session-expired" });
    await expect.element(screen.getByText("Welcome to Graft")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Local work 1" }))
      .not.toBeInTheDocument();
  });

  it("keeps browser and headless authentication separate from the desktop product gate", async () => {
    const screen = await render(
      <GraftAccountGate>
        <Workspace />
      </GraftAccountGate>,
    );
    await expect.element(screen.getByRole("button", { name: "Local work 0" })).toBeVisible();
  });
});
