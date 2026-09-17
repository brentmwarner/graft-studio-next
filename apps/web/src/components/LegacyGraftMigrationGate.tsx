import type { LegacyGraftRuntimeStatus } from "@graft/contracts";
import { useEffect, useState, type ReactNode } from "react";

import { getLegacyGraftStatus, retryLegacyGraftImport } from "../legacyGraft";
import { DesktopWindowControls } from "./DesktopWindowControls";
import { Button } from "./ui/button";

export function useLegacyGraftStatus(enabled: boolean) {
  const [status, setStatus] = useState<LegacyGraftRuntimeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await getLegacyGraftStatus(controller.signal);
        if (controller.signal.aborted) return;
        setStatus(next);
        setError(null);
        if (next.phase === "checking" || next.phase === "importing")
          timer = setTimeout(poll, 2_000);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error ? cause.message : "Graft could not check the history import.",
        );
        timer = setTimeout(poll, 5_000);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, epoch]);
  const retry = async () => {
    try {
      await retryLegacyGraftImport();
      setError(null);
      setStatus(null);
      setEpoch((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The import could not restart.");
    }
  };
  return { status, error, retry };
}

export function LegacyGraftMigrationGate({ children }: { children: ReactNode }) {
  const desktop = Boolean(window.desktopBridge);
  const { status, error, retry } = useLegacyGraftStatus(desktop);
  if (!desktop || status?.phase === "complete" || status?.phase === "no-source") return children;
  const failed = status?.phase === "failed";
  return (
    <main className="flex h-dvh flex-col bg-background text-foreground">
      <div className="drag-region h-12 shrink-0" />
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-lg space-y-4" aria-live="polite">
          <h1 className="text-2xl font-semibold">
            {failed ? "Your history needs attention" : "Bringing your Graft history over"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {failed
              ? "The import stopped safely. Your original Graft database is still intact. Close the previous app and retry."
              : "Graft is preserving the previous app’s database and importing your projects and conversations."}
          </p>
          {status?.progress ? (
            <p className="text-sm">
              {status.progress.completedCommands} of {status.progress.totalCommands} import steps
              complete
            </p>
          ) : null}
          {error || status?.error ? (
            <p role="alert" className="text-sm text-destructive">
              {error ?? status?.error}
            </p>
          ) : null}
          {failed || error ? <Button onClick={() => void retry()}>Retry import</Button> : null}
        </div>
      </div>
      <DesktopWindowControls className="fixed top-0 right-0 z-[250]" />
    </main>
  );
}
