import type { DesktopBridge, GraftAccountIssue, GraftAccountState } from "@graft/contracts";
import { useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import { SettingsCard, SettingsSectionShell } from "./SettingsPanelPrimitives";

type AccountBridge = NonNullable<DesktopBridge["account"]>;
type AccountAction = "signIn" | "cancelSignIn" | "signOut" | "refresh";

const ISSUE_MESSAGES: Record<GraftAccountIssue, string> = {
  "disconnect-failed": "Graft could not disconnect remote access. Try signing out again.",
  "sign-in-failed": "Sign-in didn’t finish. Try again in your browser.",
  timeout: "Sign-in timed out. Try again when you’re ready.",
  "session-expired": "Your session has expired. Sign in again to reconnect your account.",
  "service-unavailable": "We couldn’t reach Graft. Check your connection and try again.",
  "secure-storage-unavailable":
    "Unlock your system keyring to save your account securely, then try again.",
  "storage-failed":
    "We couldn’t read or save your account session. Try again, or sign out to remove it.",
};

export function GraftAccountSettingsPanel() {
  const bridge = window.desktopBridge?.account;
  if (!bridge) {
    return (
      <p className="text-sm text-muted-foreground">
        Open the desktop app to sign in to your Graft account.
      </p>
    );
  }
  return <ConnectedAccountPanel bridge={bridge} />;
}

export function useGraftAccount(bridge: AccountBridge | undefined) {
  const [state, setState] = useState<GraftAccountState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const revision = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    if (!bridge) return;
    mounted.current = true;
    const unsubscribe = bridge.onState((next) => {
      revision.current += 1;
      setState(next);
      setError(null);
    });
    const initialRevision = revision.current;
    void bridge.getState().then(
      (next) => {
        if (mounted.current && revision.current === initialRevision) setState(next);
      },
      () => {
        if (mounted.current && revision.current === initialRevision)
          setError("We couldn’t load your account. Try again.");
      },
    );
    return () => {
      mounted.current = false;
      revision.current += 1;
      unsubscribe();
    };
  }, [bridge]);

  async function perform(action: AccountAction): Promise<void> {
    if (!bridge) return;
    const initialRevision = revision.current;
    setPending(true);
    setError(null);
    try {
      const next = await bridge[action]();
      if (mounted.current && revision.current === initialRevision) setState(next);
    } catch {
      if (mounted.current) setError("That account action didn’t finish. Please try again.");
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  return { state, error, pending, perform };
}

export function ConnectedAccountPanel({ bridge }: { bridge: AccountBridge }) {
  const { state, error, pending, perform } = useGraftAccount(bridge);

  const signingIn = state?.status === "signing-in";
  const signedIn = state?.status === "signed-in";
  const checking = state?.status === "checking" || (state === null && error === null);
  const issue = error ?? (state?.issue ? ISSUE_MESSAGES[state.issue] : null);

  return (
    <SettingsSectionShell title="Graft account">
      <SettingsCard>
        <div className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="min-w-0 space-y-1" aria-live="polite">
            <p className="text-sm font-medium">
              {signingIn
                ? "Finish signing in in your browser"
                : checking
                  ? "Checking your account…"
                  : signedIn
                    ? state.account?.email
                    : "Sign in to Graft"}
            </p>
            <p className="text-sm text-muted-foreground">
              {signingIn
                ? "You’ll return here when sign-in is complete."
                : signedIn
                  ? "Your account is connected on this device."
                  : "Use the same account you use in Graft."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {signingIn ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void perform("cancelSignIn")}
              >
                Cancel sign-in
              </Button>
            ) : signedIn ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void perform("signOut")}
              >
                Sign out
              </Button>
            ) : (
              <>
                {state?.status === "unavailable" || error ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => void perform("refresh")}
                  >
                    Retry
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  disabled={pending || checking}
                  onClick={() => void perform("signIn")}
                >
                  Sign in to Graft
                </Button>
                {state?.status === "unavailable" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => void perform("signOut")}
                  >
                    Sign out
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
        {issue ? (
          <p role="alert" className="px-4 py-3 text-sm text-destructive">
            {issue}
          </p>
        ) : null}
      </SettingsCard>
      <p className="text-sm text-muted-foreground">
        Signing out disconnects this device. Your local projects and conversations stay here.
      </p>
    </SettingsSectionShell>
  );
}
