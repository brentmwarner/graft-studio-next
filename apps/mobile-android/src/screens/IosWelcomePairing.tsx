import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassActionPill } from "../components/GlassActionPill";
import { GraftGlassMark } from "../components/GraftGlassMark";
import { OnboardingRibbon } from "../components/OnboardingRibbon";
import { graftSpacing, useGraftPalette } from "../theme/tokens";

interface IosWelcomePairingProps {
  readonly error?: string;
  readonly isPairing: boolean;
  readonly onOpenPairing: () => void;
}

/// First-run welcome — native `WelcomeView` layout: glass mark, brand,
/// value line, 56pt black-glass Pair pill, Keychain footnote.
export function IosWelcomePairing({
  error,
  isPairing,
  onOpenPairing,
}: IosWelcomePairingProps) {
  const palette = useGraftPalette();
  const insets = useSafeAreaInsets();
  const footnote = error
    ? error
    : "Open Graft Studio on your Mac,\nthen scan or paste the pairing link.";

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: palette.background,
          paddingBottom: insets.bottom + 40,
          paddingTop: insets.top + 24,
        },
      ]}
    >
      <OnboardingRibbon />
      <View style={styles.hero}>
        <GraftGlassMark />
        <Text style={[styles.brand, { color: palette.foreground }]}>Graft</Text>
        <Text style={[styles.pitch, { color: palette.foregroundSubtle }]}>
          Control your Graft Studio from anywhere.
        </Text>
      </View>

      <View style={styles.actions}>
        <GlassActionPill
          icon="link-outline"
          isBusy={isPairing}
          onPress={onOpenPairing}
          title="Pair with Studio"
        />
        <Text
          style={[
            styles.footnote,
            { color: error ? palette.danger : palette.foregroundSubtle },
          ]}
        >
          {footnote}
        </Text>
      </View>
    </View>
  );
}

export function useIosPairingStep(hasInitialInput: boolean) {
  const [step, setStep] = useState<"welcome" | "form">(
    hasInitialInput ? "form" : "welcome",
  );
  return { setStep, step } as const;
}

const styles = StyleSheet.create({
  actions: {
    gap: graftSpacing.two,
    paddingHorizontal: 30,
  },
  brand: {
    fontSize: 32,
    fontWeight: "600",
    letterSpacing: -0.6,
    marginTop: graftSpacing.three,
  },
  footnote: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  hero: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  pitch: {
    fontSize: 16,
    marginTop: graftSpacing.one,
    paddingHorizontal: graftSpacing.four,
    textAlign: "center",
  },
  root: {
    flex: 1,
  },
});
