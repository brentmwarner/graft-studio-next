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

import type { AccountAuth } from "../auth/useAccountAuth";
import { CircleIconButton } from "../components/CircleIconButton";
import { FloatingSurface } from "../components/FloatingSurface";
import { GlassActionPill } from "../components/GlassActionPill";
import { PressScale } from "../components/PressScale";
import { Wordmark } from "../components/Wordmark";
import { graftRadius, graftSpacing, useGraftPalette } from "../theme/tokens";
import { IosWelcomePairing } from "./IosWelcomePairing";
import { iosPairingSurfaceAfter, type IosPairingSurface } from "./iosPairingFlow";
import { QrScanner } from "./QrScanner";

interface PairingScreenProps {
  readonly account?: AccountAuth;
  readonly error?: string;
  readonly initialInput?: string;
  readonly isPairing: boolean;
  readonly onPair: (input: string) => Promise<void>;
}

export function PairingScreen({
  account,
  error,
  initialInput,
  isPairing,
  onPair,
}: PairingScreenProps) {
  const palette = useGraftPalette();
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState(initialInput ?? "");
  const [isScanning, setIsScanning] = useState(false);
  const [iosSurface, setIosSurface] = useState<IosPairingSurface>(() =>
    account?.isSignedIn && initialInput ? "paste" : "welcome",
  );

  useEffect(() => {
    if (initialInput) setInput(initialInput);
  }, [initialInput]);

  useEffect(() => {
    if (Platform.OS === "ios" && account?.isSignedIn && initialInput) {
      setIosSurface(iosPairingSurfaceAfter("openPairing", true));
    }
  }, [account?.isSignedIn, initialInput]);

  if (Platform.OS === "ios" && account) {
    return (
      <View style={styles.flex}>
        <IosWelcomePairing
          account={account}
          isPairing={isPairing}
          onOpenPairing={() =>
            setIosSurface(iosPairingSurfaceAfter("openPairing", Boolean(input.trim())))
          }
          pairingError={error}
        />
        {iosSurface === "scan" ? (
          <View style={styles.cover}>
            <QrScanner
              onClose={() => setIosSurface(iosPairingSurfaceAfter("close"))}
              onPasteInstead={() => setIosSurface(iosPairingSurfaceAfter("pasteInstead"))}
              onScan={(value) => {
                setInput(value);
                setIosSurface(iosPairingSurfaceAfter("close"));
                void onPair(value);
              }}
            />
          </View>
        ) : null}
        {iosSurface === "paste" ? (
          <View style={styles.cover}>
            <IosPairingForm
              error={error}
              input={input}
              isPairing={isPairing}
              onClose={() => setIosSurface(iosPairingSurfaceAfter("close"))}
              onInputChange={setInput}
              onPair={() => void onPair(input)}
              onScan={() => setIosSurface(iosPairingSurfaceAfter("scanInstead"))}
            />
          </View>
        ) : null}
      </View>
    );
  }

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
          <Wordmark />
          <View style={styles.intro}>
            <Text style={[styles.eyebrow, { color: palette.foregroundSubtle }]}>
              ANDROID REMOTE
            </Text>
            <Text style={[styles.title, { color: palette.foreground }]}>
              Your work, away from your desk.
            </Text>
            <Text style={[styles.body, { color: palette.foregroundMuted }]}>
              Pair securely with Graft Studio. Your computer stays authoritative; this phone becomes
              a lightweight remote view.
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

function IosPairingForm({
  error,
  input,
  isPairing,
  onClose,
  onInputChange,
  onPair,
  onScan,
}: {
  readonly error?: string;
  readonly input: string;
  readonly isPairing: boolean;
  readonly onClose: () => void;
  readonly onInputChange: (value: string) => void;
  readonly onPair: () => void;
  readonly onScan: () => void;
}) {
  const palette = useGraftPalette();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.flex, { backgroundColor: palette.background }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.iosContent,
          { paddingBottom: insets.bottom + 32, paddingTop: insets.top + 8 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.iosHeader}>
          <CircleIconButton
            accessibilityLabel="Cancel pairing"
            icon="chevron-back"
            onPress={onClose}
          />
          <Text style={[styles.iosTitle, { color: palette.foreground }]}>
            Pair with Graft Studio
          </Text>
          <View style={styles.iosHeaderSpacer} />
        </View>
        <View style={styles.iosPairingBody}>
          <Ionicons color={palette.foreground} name="scan-outline" size={40} />
          <Text style={[styles.iosLead, { color: palette.foreground }]}>Scan the pairing code</Text>
          <Text style={[styles.iosHelp, { color: palette.foregroundSubtle }]}>
            Open Graft Studio on this computer, then open Settings → Mobile Pairing.
          </Text>
          <PressScale
            accessibilityLabel="Scan QR code"
            disabled={isPairing}
            onPress={onScan}
            style={[styles.iosScan, { backgroundColor: palette.foreground }]}
          >
            <Ionicons color={palette.background} name="scan" size={19} />
            <Text style={[styles.iosScanText, { color: palette.background }]}>Scan QR code</Text>
          </PressScale>
          <View style={styles.iosDividerRow}>
            <View style={[styles.iosDivider, { backgroundColor: palette.border }]} />
            <Text style={[styles.iosOr, { color: palette.foregroundSubtle }]}>
              OR PASTE THE LINK
            </Text>
            <View style={[styles.iosDivider, { backgroundColor: palette.border }]} />
          </View>
          <TextInput
            accessibilityLabel="Graft pairing link"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            editable={!isPairing}
            multiline
            onChangeText={onInputChange}
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
          {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
        </View>
        <GlassActionPill
          disabled={!input.trim()}
          icon="link-outline"
          isBusy={isPairing}
          onPress={onPair}
          title={isPairing ? "Pairing…" : "Pair with Graft Studio"}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  cover: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0, zIndex: 2 },
  iosContent: { flexGrow: 1, paddingHorizontal: 24 },
  iosHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 52,
  },
  iosHeaderSpacer: { width: 44 },
  iosTitle: { fontSize: 17, fontWeight: "600", letterSpacing: -0.2 },
  iosPairingBody: { alignItems: "center", flex: 1, justifyContent: "center", paddingVertical: 32 },
  iosLead: { fontSize: 24, fontWeight: "700", letterSpacing: -0.5, marginTop: 16 },
  iosHelp: { fontSize: 15, lineHeight: 21, marginTop: 8, maxWidth: 330, textAlign: "center" },
  iosScan: {
    alignItems: "center",
    borderRadius: graftRadius.pill,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginTop: 24,
    minHeight: 50,
    width: "100%",
  },
  iosScanText: { fontSize: 16, fontWeight: "600" },
  iosDividerRow: { alignItems: "center", flexDirection: "row", gap: 10, marginVertical: 24 },
  iosDivider: { flex: 1, height: StyleSheet.hairlineWidth },
  iosOr: { fontSize: 11, fontWeight: "600", letterSpacing: 0.7 },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: graftSpacing.three,
  },
  intro: {
    marginBottom: graftSpacing.three,
    marginTop: 44,
    maxWidth: 520,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
    marginBottom: graftSpacing.two,
  },
  title: {
    fontSize: 42,
    fontWeight: "700",
    letterSpacing: -1.8,
    lineHeight: 45,
  },
  body: {
    fontSize: 17,
    lineHeight: 25,
    marginTop: graftSpacing.two,
    maxWidth: 460,
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
