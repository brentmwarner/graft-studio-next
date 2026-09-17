import type { DesktopBridge } from "@graft/contracts";
import type { ReactNode } from "react";

import { DesktopWindowControls } from "./DesktopWindowControls";
import { ConnectedAccountPanel, useGraftAccount } from "./settings/GraftAccountSettingsPanel";

/** The desktop product account and headless/browser server authentication are separate policies. */
export function GraftAccountGate({
  children,
  bridge = window.desktopBridge?.account,
}: {
  children: ReactNode;
  bridge?: DesktopBridge["account"];
}) {
  const { state } = useGraftAccount(bridge);
  if (!bridge) return children;
  if (state?.status === "signed-in") {
    return (
      <>
        {children}
        {state.issue === "service-unavailable" ? (
          <p
            role="status"
            className="fixed bottom-3 left-3 z-[250] rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground"
          >
            Graft is offline. Your verified session remains available while we reconnect.
          </p>
        ) : null}
      </>
    );
  }
  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <div className="drag-region h-12 shrink-0" />
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Welcome to Graft</h1>
            <p className="text-sm text-muted-foreground">
              Sign in with your existing Graft account to open your workspace. Your projects and
              conversations stay on this computer.
            </p>
          </div>
          <ConnectedAccountPanel bridge={bridge} />
        </div>
      </div>
      <DesktopWindowControls className="fixed top-0 right-0 z-[250]" />
    </main>
  );
}
