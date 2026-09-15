import type { GraftDiffFileSummary, GraftDiffSummary } from "@graft/mobile-contract";
import { useCallback, useEffect, useRef, useState } from "react";

export interface DiffFileState {
  readonly loading?: boolean;
  readonly file?: GraftDiffFileSummary;
  readonly failed?: boolean;
}

/** Cache expanded files only for the current checkpoint; ignore responses after close or refresh. */
export function useDiffFiles(
  diff: GraftDiffSummary | undefined,
  visible: boolean,
  load: (threadId: string, path: string) => Promise<GraftDiffSummary | undefined>,
) {
  const [files, setFiles] = useState<Record<string, DiffFileState>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const generation = useRef(0);
  const requested = useRef(new Set<string>());
  const diffRef = useRef(diff);
  diffRef.current = diff;
  const loadRef = useRef(load);
  loadRef.current = load;
  const revision = diff ? `${diff.id}:${diff.runId ?? ""}:${diff.updatedAt}` : "";

  const request = useCallback(async (path: string, retry = false) => {
    const diff = diffRef.current;
    if (!diff || (requested.current.has(path) && !retry)) return;
    const active = generation.current;
    requested.current.add(path);
    setFiles((current) => ({ ...current, [path]: { loading: true } }));
    try {
      const response = await loadRef.current(diff.threadId, path);
      if (active !== generation.current) return;
      const file = response?.files.find((entry) => entry.path === path);
      // A checkpoint that advanced during the request must not be mixed with this sheet's totals.
      const matches = response?.runId === diff.runId && response?.updatedAt === diff.updatedAt;
      setFiles((current) => ({
        ...current,
        [path]:
          matches && file
            ? { file, failed: file.detailStatus === "unavailable" }
            : { failed: true },
      }));
    } catch {
      if (active === generation.current)
        setFiles((current) => ({ ...current, [path]: { failed: true } }));
    }
  }, []);

  useEffect(() => {
    generation.current += 1;
    requested.current.clear();
    setFiles({});
    const first = visible ? diffRef.current?.files[0]?.path : undefined;
    setExpanded(new Set(first ? [first] : []));
    if (first) void request(first);
    return () => {
      generation.current += 1;
    };
    // Equivalent summary objects from background refreshes must not collapse the reader's files.
  }, [revision, visible, request]);

  function toggle(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!expanded.has(path)) void request(path);
  }

  return { files, expanded, toggle, request, collapseAll: () => setExpanded(new Set()) };
}
