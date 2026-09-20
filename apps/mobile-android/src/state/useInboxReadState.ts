import type { GraftEnvironmentSnapshot, GraftTimelineEvent } from "@graft/mobile-contract";
import Storage from "expo-sqlite/kv-store";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { parseThreadReads, reconcileThreadReads, type ThreadReadState } from "./threadActivity";

const noEvents: readonly GraftTimelineEvent[] = [];
export function useInboxReadState(
  environmentId: string | undefined,
  snapshot: GraftEnvironmentSnapshot | null,
  events: readonly GraftTimelineEvent[] = noEvents,
  visibleThreadId?: string,
): ThreadReadState {
  const key = environmentId ? `inbox.reads.${environmentId}` : undefined;
  const initial = useMemo(() => {
    try {
      return key ? parseThreadReads(Storage.getItemSync(key)) : {};
    } catch {
      return {};
    }
  }, [key]);
  const [saved, setSaved] = useState<{ key: string | undefined; reads: ThreadReadState }>({
    key,
    reads: initial,
  });
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const reads = saved.key === key ? saved.reads : initial;
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!key) return;
    const visible =
      foreground && snapshot?.selectedTranscript?.threadId === visibleThreadId
        ? visibleThreadId
        : undefined;
    const next = reconcileThreadReads(reads, snapshot, events, visible);
    if (next === reads) return;
    setSaved({ key, reads: next });
    try {
      Storage.setItemSync(key, JSON.stringify(next));
    } catch (error) {
      console.warn("Could not save viewed responses", error);
    }
  }, [key, reads, snapshot, events, visibleThreadId, foreground]);
  return reads;
}
