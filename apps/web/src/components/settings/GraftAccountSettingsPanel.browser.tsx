import "../../index.css";

import type { DesktopBridge, GraftAccountState } from "@graft/contracts";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ConnectedAccountPanel } from "./GraftAccountSettingsPanel";

const signedOut: GraftAccountState = { status: "signed-out", account: null, issue: null };
const signedIn: GraftAccountState = {
  status: "signed-in",
  account: { accountId: "existing-account", email: "person@example.test" },
  issue: null,
};

function harness() {
  let listener: ((state: GraftAccountState) => void) | undefined;
  const unsubscribe = vi.fn();
  const bridge: NonNullable<DesktopBridge["account"]> = {
    getState: vi.fn(async () => signedOut),
    signIn: vi.fn(async () => ({ ...signedOut, status: "signing-in" as const })),
    cancelSignIn: vi.fn(async () => signedOut),
    signOut: vi.fn(async () => signedOut),
    refresh: vi.fn(async () => signedIn),
    onState: vi.fn((next) => {
      listener = next;
      return unsubscribe;
    }),
  };
  return { bridge, unsubscribe, emit: (state: GraftAccountState) => listener?.(state) };
}

describe("Graft account settings", () => {
  it("starts and cancels browser sign-in, shows the verified account, and signs out", async () => {
    const { bridge, emit, unsubscribe } = harness();
    const screen = await render(<ConnectedAccountPanel bridge={bridge} />);
    await screen.getByRole("button", { name: "Sign in to Graft", exact: true }).click();
    await expect.element(screen.getByText("Finish signing in in your browser")).toBeVisible();
    await screen.getByRole("button", { name: "Cancel sign-in" }).click();
    expect(bridge.cancelSignIn).toHaveBeenCalledOnce();
    emit(signedIn);
    await expect.element(screen.getByText("person@example.test")).toBeVisible();
    await screen.getByRole("button", { name: "Sign out", exact: true }).click();
    expect(bridge.signOut).toHaveBeenCalledOnce();
    await expect
      .element(screen.getByRole("button", { name: "Sign in to Graft", exact: true }))
      .toBeVisible();
    await screen.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not overwrite a live sign-in event with a stale initial response", async () => {
    const { bridge, emit } = harness();
    let resolve!: (state: GraftAccountState) => void;
    bridge.getState = () =>
      new Promise((done) => {
        resolve = done;
      });
    const screen = await render(<ConnectedAccountPanel bridge={bridge} />);
    emit(signedIn);
    resolve(signedOut);
    await expect.element(screen.getByText("person@example.test")).toBeVisible();
  });

  it("shows an outage and retries without pretending the session is connected", async () => {
    const { bridge } = harness();
    bridge.getState = async () => ({
      status: "unavailable",
      account: signedIn.account,
      issue: "service-unavailable",
    });
    const screen = await render(<ConnectedAccountPanel bridge={bridge} />);
    await expect.element(screen.getByRole("alert")).toHaveTextContent("We couldn’t reach Graft");
    await screen.getByRole("button", { name: "Retry" }).click();
    await expect.element(screen.getByText("person@example.test")).toBeVisible();
  });
});
