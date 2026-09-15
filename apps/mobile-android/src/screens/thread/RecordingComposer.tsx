import { Ionicons } from "@expo/vector-icons";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { PressScale } from "../../components/PressScale";
import { useGraftPalette } from "../../theme/tokens";
import type { VoiceInputPhase } from "./voiceInputSession";

const SAMPLE_COUNT = 48;

// Keep meter updates local to the waveform, just like iOS's RecordingWaveform.
// Silence remains a row of dots; only real microphone levels raise the bars.
function RecordingWaveform() {
  const palette = useGraftPalette();
  const [levels, setLevels] = useState(() => Array<number>(SAMPLE_COUNT).fill(0));
  useEffect(() => {
    const subscription = ExpoSpeechRecognitionModule.addListener("volumechange", ({ value }) => {
      const level = Number.isFinite(value) ? Math.max(0, Math.min(1, value / 10)) : 0;
      setLevels((history) => [...history.slice(1), level]);
    });
    return () => subscription.remove();
  }, []);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.waveform}
    >
      {levels.map((level, index) => (
        <View key={index} style={styles.sample}>
          <View
            style={[
              styles.bar,
              {
                backgroundColor: palette.foreground,
                height: Math.max(2, Math.min(1, level * 1.15) * 22),
                opacity: (0.2 + (0.8 * index) / (SAMPLE_COUNT - 1)) *
                  (index > 42 ? (SAMPLE_COUNT - index) / 6 : 1),
              },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

export function RecordingComposer({
  phase,
  canSend,
  onStop,
  onSend,
}: {
  readonly phase: VoiceInputPhase;
  readonly canSend: boolean;
  readonly onStop: () => void;
  readonly onSend: () => void;
}) {
  const palette = useGraftPalette();
  return (
    <View style={styles.row}>
      {phase === "listening" ? (
        <>
          <RecordingWaveform />
          <PressScale accessibilityLabel="Stop and review" onPress={onStop}>
            <View style={[styles.stopButton, { backgroundColor: palette.subtle }]}>
              <View style={[styles.stopGlyph, { backgroundColor: palette.foreground }]} />
            </View>
          </PressScale>
          <PressScale accessibilityLabel="Send dictation" disabled={!canSend} onPress={onSend}>
            <View style={[styles.sendButton, { backgroundColor: palette.foreground }]}>
              <Ionicons color={palette.background} name="arrow-up" size={20} />
            </View>
          </PressScale>
        </>
      ) : (
        <>
          <ActivityIndicator size="small" color={palette.foregroundSubtle} />
          <Text
            accessibilityLiveRegion="polite"
            numberOfLines={1}
            style={[styles.status, { color: palette.foregroundSubtle }]}
          >
            {phase === "starting" ? "Starting…" : "Transcribing…"}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, height: 36, flexDirection: "row", alignItems: "center", gap: 8 },
  waveform: { flex: 1, height: 22, flexDirection: "row", alignItems: "center" },
  sample: { flex: 1, alignItems: "center" },
  bar: { width: 2, borderRadius: 1 },
  stopButton: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  stopGlyph: { width: 12, height: 12, borderRadius: 2 },
  sendButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  status: { flex: 1, fontSize: 14 },
});
