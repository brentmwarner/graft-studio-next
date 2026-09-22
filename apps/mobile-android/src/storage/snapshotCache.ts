import {
  GraftEnvironmentSnapshotSchema,
  type GraftEnvironmentSnapshot,
} from "@graft/mobile-contract";
import Storage from "expo-sqlite/kv-store";

const snapshotKey = (environmentId: string) => `inbox.snapshot.${environmentId}`;
const transcriptKey = (environmentId: string, threadId: string) =>
  `inbox.transcript.${JSON.stringify([environmentId, threadId])}`;
const indexKey = (environmentId: string) => `inbox.transcripts.${environmentId}`;

export function loadCachedSnapshot(
  environmentId: string,
  threadId?: string,
): GraftEnvironmentSnapshot | null {
  try {
    const raw = Storage.getItemSync(snapshotKey(environmentId));
    if (!raw) return null;
    const snapshot = GraftEnvironmentSnapshotSchema.safeParse(JSON.parse(raw));
    if (!snapshot.success || snapshot.data.environment.id !== environmentId) return null;
    const transcript = threadId
      ? Storage.getItemSync(transcriptKey(environmentId, threadId))
      : null;
    if (!transcript) return snapshot.data;
    const restored = GraftEnvironmentSnapshotSchema.safeParse({
      ...snapshot.data,
      selectedTranscript: JSON.parse(transcript),
    });
    return restored.success && restored.data.selectedTranscript?.threadId === threadId
      ? restored.data
      : snapshot.data;
  } catch {
    return null;
  }
}
export function saveCachedSnapshot(snapshot: GraftEnvironmentSnapshot): void {
  try {
    const environmentId = snapshot.environment.id;
    Storage.setItemSync(
      snapshotKey(environmentId),
      JSON.stringify({ ...snapshot, selectedTranscript: null }),
    );
    const transcript = snapshot.selectedTranscript;
    if (!transcript) return;
    Storage.setItemSync(
      transcriptKey(environmentId, transcript.threadId),
      JSON.stringify(transcript),
    );
    const raw: unknown = JSON.parse(Storage.getItemSync(indexKey(environmentId)) ?? "[]");
    const ids = Array.isArray(raw)
      ? raw.filter((id): id is string => typeof id === "string" && id !== transcript.threadId)
      : [];
    ids.push(transcript.threadId);
    for (const id of ids.slice(0, -50)) Storage.removeItemSync(transcriptKey(environmentId, id));
    Storage.setItemSync(indexKey(environmentId), JSON.stringify(ids.slice(-50)));
  } catch {
    /* A cache failure must not interrupt the live connection. */
  }
}
