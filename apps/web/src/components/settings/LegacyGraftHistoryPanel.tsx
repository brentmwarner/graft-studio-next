import type { LegacyGraftThreadSummary } from "@graft/contracts";
import { useState } from "react";

import { getLegacyGraftArchive } from "../../legacyGraft";
import { useLegacyGraftStatus } from "../LegacyGraftMigrationGate";
import { Button } from "../ui/button";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { SettingsCard, SettingsSectionShell } from "./SettingsPanelPrimitives";

export function LegacyGraftHistoryPanel() {
  const { status, error, retry } = useLegacyGraftStatus(true);
  const [selected, setSelected] = useState<LegacyGraftThreadSummary | null>(null);
  const [page, setPage] = useState<Awaited<ReturnType<typeof getLegacyGraftArchive>> | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(100);
  const summary = status?.progress?.summary;
  if (status?.phase === "no-source") return null;

  async function read(thread: LegacyGraftThreadSummary, offset = 0) {
    setLoading(true);
    setArchiveError(null);
    try {
      const next = await getLegacyGraftArchive(thread.sourceThreadId, offset);
      setSelected(thread);
      setPage(next);
    } catch (cause) {
      setArchiveError(cause instanceof Error ? cause.message : "The archive could not be opened.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SettingsSectionShell title="Previous Graft history">
      <p className="text-sm text-muted-foreground">
        The original database is preserved. Imported conversations are read-only; start a new chat
        in the same project to continue. Tools, plans, and other historical records are available in
        the archive below. Previous automations stay inactive.
      </p>
      {summary ? (
        <p className="text-sm">
          {summary.importedProjects} projects · {summary.importedThreads} imported conversations ·{" "}
          {summary.archiveOnlyThreads} conversations in the archive
        </p>
      ) : null}
      {error || status?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {error ?? status?.error}
        </p>
      ) : null}
      {status?.phase === "failed" ? (
        <Button onClick={() => void retry()}>Retry import</Button>
      ) : null}
      {summary?.warnings.map((warning) => (
        <p key={warning} className="text-sm text-muted-foreground">
          {warning}
        </p>
      ))}
      <SettingsCard>
        <ul className="max-h-72 divide-y overflow-auto">
          {summary?.threads.slice(0, visibleCount).map((thread) => (
            <li key={thread.sourceThreadId} className="flex items-center justify-between gap-4 p-3">
              <span className="min-w-0 truncate text-sm">{thread.title}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => void read(thread)}
              >
                View archive
              </Button>
            </li>
          ))}
        </ul>
      </SettingsCard>
      {summary && summary.threads.length > visibleCount ? (
        <Button variant="outline" onClick={() => setVisibleCount((count) => count + 100)}>
          Show more conversations
        </Button>
      ) : null}
      {archiveError ? (
        <p role="alert" className="text-sm text-destructive">
          {archiveError}
        </p>
      ) : null}
      <DisclosureRegion open={Boolean(selected && page)}>
        {selected && page ? (
          <section aria-label={`${selected.title} archive`} className="space-y-3">
            <h3 className="font-medium">{selected.title}</h3>
            {selected.reasons.map((reason) => (
              <p key={reason} className="text-sm text-muted-foreground">
                {reason}
              </p>
            ))}
            <div className="max-h-96 space-y-3 overflow-auto rounded-lg border p-4">
              {page.records.map((record, index) => (
                <article key={index} className="space-y-1 border-b pb-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    {record.table}
                    {typeof record.row.role === "string" ? ` · ${record.row.role}` : ""}
                  </p>
                  <pre className="whitespace-pre-wrap break-words text-sm">
                    {typeof record.row.content === "string"
                      ? record.row.content
                      : JSON.stringify(record.row, null, 2)}
                  </pre>
                </article>
              ))}
            </div>
            <div className="flex gap-2">
              {page.nextOffset !== null ? (
                <Button
                  variant="outline"
                  disabled={loading}
                  onClick={() => void read(selected, page.nextOffset ?? 0)}
                >
                  Next records
                </Button>
              ) : null}
              <Button
                variant="ghost"
                onClick={() => {
                  setSelected(null);
                  setPage(null);
                }}
              >
                Close archive
              </Button>
            </div>
          </section>
        ) : null}
      </DisclosureRegion>
    </SettingsSectionShell>
  );
}
