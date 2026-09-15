import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { createVoiceInputSession, type VoiceInputState } from "./voiceInputSession";

export function useVoiceInput(
  threadId: string,
  enabled: boolean,
  onDraftChange: (text: string) => void,
) {
  const [state, setState] = useState<VoiceInputState>({ phase: "idle" });
  const sessionRef = useRef<ReturnType<typeof createVoiceInputSession> | null>(null);

  useEffect(() => {
    const session = createVoiceInputSession(
      ExpoSpeechRecognitionModule,
      setState,
      onDraftChange,
      () => AppState.currentState === "active",
    );
    sessionRef.current = session;
    setState({ phase: "idle" });
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") session.resume();
      else session.pause();
    });
    return () => {
      subscription.remove();
      session.dispose();
      sessionRef.current = null;
    };
  }, [onDraftChange, threadId]);

  useEffect(() => {
    if (!enabled) sessionRef.current?.cancel(false);
  }, [enabled]);

  return {
    ...state,
    isActive: state.phase !== "idle",
    start: (draft: string) => {
      if (enabled) void sessionRef.current?.start(draft);
    },
    stop: () => sessionRef.current?.stop() ?? Promise.resolve(undefined),
    cancel: () => sessionRef.current?.cancel(),
  };
}
