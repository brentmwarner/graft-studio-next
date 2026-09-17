import { LegacyGraftRuntimeStatus } from "@graft/contracts";
import { Schema } from "effect";

import { resolveWsHttpUrl } from "./lib/wsHttpUrl";

export async function getLegacyGraftStatus(signal?: AbortSignal) {
  const response = await fetch(resolveWsHttpUrl("/api/graft/legacy/status"), {
    credentials: "include",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error("Graft could not check the history import. Try again.");
  return Schema.decodeUnknownSync(LegacyGraftRuntimeStatus)(await response.json());
}

export async function retryLegacyGraftImport() {
  const response = await fetch(resolveWsHttpUrl("/api/graft/legacy/retry"), {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("The import could not restart. Try again.");
}

export async function getLegacyGraftArchive(sourceThreadId: string, offset = 0) {
  const url = `/api/graft/legacy/thread?id=${encodeURIComponent(sourceThreadId)}&offset=${offset}`;
  const response = await fetch(resolveWsHttpUrl(url), { credentials: "include" });
  if (!response.ok) throw new Error("Graft could not read this conversation's archive.");
  return (await response.json()) as {
    records: Array<{ table: string; row: Record<string, unknown> }>;
    nextOffset: number | null;
  };
}
