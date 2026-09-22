import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FloatingSurface } from "../components/FloatingSurface";
import { GraftMark } from "../components/GraftMark";
import { PressScale } from "../components/PressScale";
import { graftRadius, graftSpacing, useGraftPalette } from "../theme/tokens";
import { QrScanner } from "./QrScanner";
import { PAIRING_FOOTNOTE } from "./welcomeCopy";

interface PairingScreenProps {
  readonly error?: string;
  readonly initialInput?: string;
  readonly isPairing: boolean;
  readonly onCancel?: () => void;
  readonly onPair: (input: string) => Promise<boolean | void>;
}

export function PairingScreen({
  error,
  initialInput,
  isPairing,
  onCancel,
  onPair,
}: PairingScreenProps) {
  const palette = useGraftPalette();
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState(initialInput ?? "");
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    if (initialInput) setInput(initialInput);
  }, [initialInput]);

  return (
    <>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: insets.top + graftSpacing.four,
              paddingBottom: insets.bottom + graftSpacing.four,
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {onCancel ? (
            <PressScale
              accessibilityLabel="Cancel pairing"
              disabled={isPairing}
              onPress={onCancel}
              style={styles.cancel}
            >
              <Text style={[styles.cancelText, { color: palette.accent }]}>Cancel</Text>
            </PressScale>
          ) : null}
          <View style={styles.hero} accessibilityRole="header">
            <GraftMark size={72} />
            <Text style={[styles.brand, { color: palette.foreground }]}>Graft</Text>
            <Text style={[styles.footnote, { color: palette.foregroundMuted }]}>
              {PAIRING_FOOTNOTE}
            </Text>
          </View>

          <FloatingSurface style={styles.formSurface}>
            <View style={styles.form}>
              <Text style={[styles.label, { color: palette.foreground }]}>Pairing link</Text>
              <TextInput
                accessibilityLabel="Graft pairing link"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                editable={!isPairing}
                multiline
                onChangeText={setInput}
                placeholder="graft://pair?v=1&host=…"
                placeholderTextColor={palette.foregroundSubtle}
                selectionColor={palette.foreground}
                style={[
                  styles.input,
                  {
                    backgroundColor: palette.subtle,
                    borderColor: error ? palette.danger : palette.border,
                    color: palette.foreground,
                  },
                ]}
                value={input}
              />
              {error ? (
                <View style={styles.errorRow}>
                  <Ionicons color={palette.danger} name="alert-circle-outline" size={17} />
                  <Text style={[styles.error, { color: palette.danger }]}>{error}</Text>
                </View>
              ) : null}

              <PressScale
                accessibilityLabel={isPairing ? "Pairing" : "Pair with Graft Studio"}
                disabled={isPairing || !input.trim()}
                onPress={() => void onPair(input)}
                style={[styles.primaryButton, { backgroundColor: palette.foreground }]}
              >
                <Text style={[styles.primaryButtonText, { color: palette.background }]}>
                  {isPairing ? "Pairing…" : "Pair with Graft Studio"}
                </Text>
                <Ionicons
                  color={palette.background}
                  name={isPairing ? "ellipsis-horizontal" : "arrow-forward"}
                  size={19}
                />
              </PressScale>

              <PressScale
                accessibilityLabel="Scan pairing QR code"
                disabled={isPairing}
                onPress={() => setIsScanning(true)}
                style={[styles.scanButton, { borderColor: palette.border }]}
              >
                <Ionicons color={palette.foreground} name="scan" size={20} />
                <Text style={[styles.scanButtonText, { color: palette.foreground }]}>
                  Scan QR code
                </Text>
              </PressScale>
            </View>
          </FloatingSurface>

          <View style={styles.privacyRow}>
            <Ionicons color={palette.foregroundSubtle} name="lock-closed-outline" size={14} />
            <Text style={[styles.privacy, { color: palette.foregroundSubtle }]}>
              Session credentials stay in Android secure storage.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        animationType="fade"
        onRequestClose={() => setIsScanning(false)}
        statusBarTranslucent
        visible={isScanning}
      >
        <QrScanner
          onClose={() => setIsScanning(false)}
          onScan={(value) => {
            setIsScanning(false);
            setInput(value);
            void onPair(value);
          }}
        />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: graftSpacing.three,
  },
  cancel: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
  },
  cancelText: {
    fontSize: 16,
    fontWeight: "600",
  },
  hero: {
    alignItems: "center",
    marginBottom: graftSpacing.three,
    paddingVertical: graftSpacing.four,
  },
  brand: {
    fontSize: 32,
    fontWeight: "600",
    letterSpacing: -0.6,
    marginTop: graftSpacing.two,
  },
  footnote: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: graftSpacing.two,
    textAlign: "center",
  },
  formSurface: {
    borderRadius: graftRadius.sheet,
  },
  form: {
    padding: graftSpacing.three,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: graftSpacing.one,
  },
  input: {
    borderRadius: graftRadius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 92,
    paddingHorizontal: 14,
    paddingVertical: 13,
    textAlignVertical: "top",
  },
  errorRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 7,
    marginTop: 10,
  },
  error: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: graftRadius.pill,
    flexDirection: "row",
    gap: graftSpacing.one,
    justifyContent: "center",
    marginTop: graftSpacing.two,
    minHeight: 54,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "700",
  },
  scanButton: {
    alignItems: "center",
    borderRadius: graftRadius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: graftSpacing.one,
    justifyContent: "center",
    marginTop: 10,
    minHeight: 52,
  },
  scanButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  privacyRow: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: graftSpacing.three,
  },
  privacy: {
    fontSize: 12,
  },
});
