import type {
  ExpoSpeechRecognitionErrorCode,
  ExpoSpeechRecognitionModule,
} from "expo-speech-recognition";

export type VoiceInputPhase = "idle" | "starting" | "listening" | "stopping";
export interface VoiceInputState {
  readonly phase: VoiceInputPhase;
  readonly error?: string;
}

type SpeechModule = Pick<
  typeof ExpoSpeechRecognitionModule,
  "addListener" | "requestPermissionsAsync" | "isRecognitionAvailable" | "start" | "stop" | "abort"
>;

const VOICE_ERRORS: Record<ExpoSpeechRecognitionErrorCode, string> = {
  aborted: "Dictation was cancelled.",
  "audio-capture": "Could not access the microphone. Close other recording apps and try again.",
  interrupted: "Dictation was interrupted. Tap the microphone to try again.",
  "bad-grammar": "Speech recognition could not start. Please try again.",
  "language-not-supported": "Speech recognition is unavailable for your device language.",
  network: "Speech recognition could not connect. Check your connection and try again.",
  "no-speech": "No speech was detected. Tap the microphone and try again.",
  "not-allowed": "Allow microphone access for Graft in Android Settings to use dictation.",
  "service-not-allowed":
    "Enable a speech recognition service in Android Settings to use dictation.",
  busy: "The speech recognizer is busy. Please try again.",
  client: "Speech recognition stopped unexpectedly. Please try again.",
  "speech-timeout": "No speech was detected. Tap the microphone and try again.",
  unknown: "Speech recognition failed. Please try again.",
};

/** One composer's native recording lifecycle, including pending permission requests. */
export function createVoiceInputSession(
  native: SpeechModule,
  onState: (state: VoiceInputState) => void,
  onDraft: (text: string) => void,
  isForeground: () => boolean = () => true,
) {
  let phase: VoiceInputPhase = "idle";
  let disposed = false;
  let generation = 0;
  let capturing = false;
  let acceptingResults = false;
  let readyToStart = false;
  let initialDraft = "";
  let capturedDraft: string | undefined;
  let finalResult = false;
  let completion: Promise<string | undefined> | undefined;
  let resolveCompletion: ((text: string | undefined) => void) | undefined;
  let failure: string | undefined;

  const finish = (text?: string) => {
    resolveCompletion?.(text);
    resolveCompletion = undefined;
    completion = undefined;
  };

  const update = (next: VoiceInputPhase) => {
    phase = next;
    if (!disposed) onState({ phase, ...(failure ? { error: failure } : {}) });
  };
  const subscriptions = [
    native.addListener("start", () => {
      if (capturing && acceptingResults && phase === "starting") update("listening");
    }),
    native.addListener("result", (event) => {
      if (disposed || !acceptingResults) return;
      const transcript = event.results[0]?.transcript.trim();
      if (!transcript) return;
      const prefix = initialDraft.trimEnd();
      capturedDraft = prefix ? `${prefix} ${transcript}` : transcript;
      finalResult = event.isFinal;
      onDraft(capturedDraft);
    }),
    native.addListener("error", (event) => {
      if (!capturing || disposed) return;
      if (acceptingResults) failure = VOICE_ERRORS[event.error];
      acceptingResults = false;
      // Native recognition emits end after error. Keep starts blocked until
      // then so a late result/end cannot affect the next recording.
      update("stopping");
    }),
    native.addListener("nomatch", () => {
      if (disposed || !acceptingResults) return;
      failure = VOICE_ERRORS["no-speech"];
      acceptingResults = false;
      update("stopping");
    }),
    native.addListener("end", () => {
      if (!capturing || disposed) return;
      capturing = false;
      acceptingResults = false;
      update("idle");
      finish(!failure && finalResult ? capturedDraft : undefined);
    }),
  ];

  const failStart = () => {
    acceptingResults = false;
    readyToStart = false;
    failure = "Could not start dictation. Check microphone access and try again.";
    if (capturing) {
      update("stopping");
      native.abort();
    } else {
      update("idle");
    }
  };
  const beginCapture = () => {
    if (disposed || !readyToStart || phase !== "starting" || !isForeground()) return;
    readyToStart = false;
    capturing = true;
    acceptingResults = true;
    try {
      native.start({
        lang: Intl.DateTimeFormat().resolvedOptions().locale,
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 60 },
      });
    } catch {
      failStart();
    }
  };
  const cancel = (restoreDraft = true) => {
    if (disposed || phase === "idle") return;
    generation += 1;
    acceptingResults = false;
    readyToStart = false;
    failure = undefined;
    finish();
    if (restoreDraft) onDraft(initialDraft);
    if (capturing) {
      update("stopping");
      native.abort();
    } else {
      update("idle");
    }
  };

  return {
    async start(draft: string) {
      if (disposed || phase !== "idle") return;
      const request = ++generation;
      initialDraft = draft;
      capturedDraft = undefined;
      finalResult = false;
      failure = undefined;
      update("starting");
      try {
        if (!native.isRecognitionAvailable()) {
          failure = VOICE_ERRORS["service-not-allowed"];
          update("idle");
          return;
        }
        const permission = await native.requestPermissionsAsync();
        if (disposed || request !== generation) return;
        if (!permission.granted) {
          failure = VOICE_ERRORS["not-allowed"];
          update("idle");
          return;
        }
        readyToStart = true;
        beginCapture();
      } catch {
        if (disposed || request !== generation) return;
        failStart();
      }
    },
    stop(): Promise<string | undefined> {
      if (completion) return completion;
      if (!capturing || phase !== "listening") return Promise.resolve(undefined);
      const pending = new Promise<string | undefined>((resolve) => {
        resolveCompletion = resolve;
      });
      completion = pending;
      update("stopping");
      native.stop();
      return pending;
    },
    cancel,
    pause() {
      // Android's permission Activity pauses the app, even for an already
      // granted permission. Only interrupt actual capture, not that request.
      if (capturing) cancel(false);
    },
    resume: beginCapture,
    dispose() {
      disposed = true;
      generation += 1;
      finish();
      subscriptions.forEach((subscription) => subscription.remove());
      if (capturing) native.abort();
    },
  };
}
