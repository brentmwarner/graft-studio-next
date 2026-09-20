import type { GraftTimelineEvent } from "@graft/mobile-contract";
import { AndroidHaptics, performAndroidHapticsAsync } from "expo-haptics";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { transcriptMessageId } from "../../state/mobileViewModels";

/** A few quiet ticks for live text, never for tools, history, or catch-up snapshots. */
export function useStreamingHaptics(
  threadId: string,
  runId: string | undefined,
  events: readonly GraftTimelineEvent[],
  enabled: boolean,
) {
  const reducedMotion = useReducedMotion();
  const previous = useRef<{ id: string; text: string; cursor: number } | undefined>(undefined);
  const wasEnabled = useRef(false);
  const cadence = useRef({ count: 0, at: 0 });
  useEffect(() => {
    previous.current = undefined;
    cadence.current = { count: 0, at: 0 };
  }, [threadId, runId]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", () => {
      previous.current = undefined;
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    const event = events.findLast(
      (candidate) => candidate.threadId === threadId && candidate.kind === "assistant.delta",
    );
    const before = previous.current;
    const canPulse = enabled && wasEnabled.current;
    wasEnabled.current = enabled;
    previous.current = event
      ? { id: transcriptMessageId(event.id), text: event.text ?? "", cursor: event.cursor }
      : undefined;
    if (
      !canPulse ||
      reducedMotion ||
      !runId ||
      AppState.currentState !== "active" ||
      !before ||
      !event
    )
      return;
    if (event.runId && event.runId !== runId) return;
    const text = event.text ?? "";
    if (
      event.cursor <= before.cursor ||
      !text ||
      (transcriptMessageId(event.id) === before.id &&
        (!text.startsWith(before.text) || text.length <= before.text.length))
    )
      return;
    const now = Date.now();
    if (cadence.current.count >= 3 || now - cadence.current.at < 1_200) return;
    cadence.current = { count: cadence.current.count + 1, at: now };
    void performAndroidHapticsAsync(AndroidHaptics.Segment_Frequent_Tick).catch(() => undefined);
  }, [enabled, events, reducedMotion, runId, threadId]);
}
