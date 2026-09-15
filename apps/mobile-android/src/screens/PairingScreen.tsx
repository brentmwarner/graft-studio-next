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
  const [input, setInput] = useState(initialInput ?? "");
  const [isScanning, setIsScanning] = useState(false);
  const [iosSurface, setIosSurface] = useState<IosPairingSurface>(() =>
    account?.isSignedIn && initialInput ? "paste" : "welcome",
  );
  const isIos = Platform.OS === "ios";

  useEffect(() => {
    if (initialInput) setInput(initialInput);
  }, [initialInput]);

  useEffect(() => {
    if (isIos && account?.isSignedIn && initialInput) {
      setIosSurface(iosPairingSurfaceAfter("openPairing", true));
    }
  }, [account?.isSignedIn, initialInput, isIos]);

  const form = (
    <PairingForm
      error={error}
      input={input}
      isIos={isIos}
      isPairing={isPairing}
      onCloseIos={isIos ? () => setIosSurface(iosPairingSurfaceAfter("close")) : undefined}
      onInputChange={setInput}
      onPair={() => void onPair(input)}
      onScan={() => {
        if (isIos) {
          setIosSurface(iosPairingSurfaceAfter("scanInstead"));
          return;
        }
        setIsScanning(true);
      }}
    />
  );

  if (isIos && account) {
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
        {iosSurface === "paste" ? <View style={styles.cover}>{form}</View> : null}
      </View>
    );
  }

  return (
    <>
      {form}
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

function PairingForm({
  error,
  input,
  isIos,
  isPairing,
  onCloseIos,
  onInputChange,
  onPair,
  onScan,
}: {
  readonly error?: string;
  readonly input: string;
  readonly isIos: boolean;
  readonly isPairing: boolean;
  readonly onCloseIos?: () => void;
  readonly onInputChange: (value: string) => void;
  readonly onPair: () => void;
  readonly onScan: () => void;
}) {
  const palette = useGraftPalette();
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.flex, isIos ? { backgroundColor: palette.background } : null]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          isIos
            ? {
                paddingBottom: insets.bottom + graftSpacing.four,
                paddingTop: insets.top + graftSpacing.one,
              }
            : {
                paddingBottom: insets.bottom + graftSpacing.four,
                paddingTop: insets.top + graftSpacing.four,
              },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {isIos ? (
          <View style={styles.iosPasteHeader}>
            {onCloseIos ? (
              <CircleIconButton
                accessibilityLabel="Close pairing"
                icon="chevron-back"
                onPress={onCloseIos}
              />
            ) : null}
            <Text style={[styles.iosPasteTitle, { color: palette.foreground }]}>
              Pair with Studio
            </Text>
            <View style={styles.iosPasteHeaderSpacer} />
          </View>
        ) : (
          <Wordmark />
        )}
        {isIos ? null : (
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
        )}

        {isIos ? (
          <PressScale
            accessibilityLabel="Scan QR code"
            disabled={isPairing}
            onPress={onScan}
            style={[styles.scanPrimary, { backgroundColor: palette.foreground }]}
          >
            <Ionicons color={palette.background} name="scan" size={19} />
            <Text style={[styles.scanPrimaryText, { color: palette.background }]}>
              Scan QR code
            </Text>
          </PressScale>
        ) : null}

        <FloatingSurface style={styles.formSurface}>
          <View style={styles.form}>
            <Text style={[styles.label, { color: palette.foreground }]}>
              {isIos ? "Or paste the link" : "Pairing link"}
            </Text>
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
            {error ? (
              <View style={styles.errorRow}>
                <Ionicons color={palette.danger} name="alert-circle-outline" size={17} />
                <Text style={[styles.error, { color: palette.danger }]}>{error}</Text>
              </View>
            ) : null}

            {isIos ? (
              <Text style={[styles.helper, { color: palette.foregroundSubtle }]}>
                Paste the link from Graft Studio → Settings → Mobile Pairing.
              </Text>
            ) : (
              <>
                <PressScale
                  accessibilityLabel={isPairing ? "Pairing" : "Pair with Graft"}
                  disabled={isPairing || !input.trim()}
                  onPress={onPair}
                  style={[styles.primaryButton, { backgroundColor: palette.foreground }]}
                >
                  <Text style={[styles.primaryButtonText, { color: palette.background }]}>
                    {isPairing ? "Pairing…" : "Pair with Graft"}
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
                  onPress={onScan}
                  style={[styles.scanButton, { borderColor: palette.border }]}
                >
                  <Ionicons color={palette.foreground} name="scan" size={20} />
                  <Text style={[styles.scanButtonText, { color: palette.foreground }]}>
                    Scan QR code
                  </Text>
                </PressScale>
              </>
            )}
          </View>
        </FloatingSurface>

        {isIos ? null : (
          <View style={styles.privacyRow}>
            <Ionicons color={palette.foregroundSubtle} name="lock-closed-outline" size={14} />
            <Text style={[styles.privacy, { color: palette.foregroundSubtle }]}>
              Session credentials stay in Android secure storage.
            </Text>
          </View>
        )}

        {isIos ? (
          <View style={styles.iosPrimary}>
            <GlassActionPill
              disabled={!input.trim()}
              icon="link-outline"
              isBusy={isPairing}
              onPress={onPair}
              title={isPairing ? "Pairing…" : "Pair with Studio"}
            />
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  body: {
    fontSize: 17,
    lineHeight: 25,
    marginTop: graftSpacing.two,
    maxWidth: 460,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: graftSpacing.three,
  },
  cover: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
  },
  error: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  errorRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 7,
    marginTop: 10,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
    marginBottom: graftSpacing.two,
  },
  flex: {
    flex: 1,
  },
  form: {
    padding: graftSpacing.three,
  },
  formSurface: {
    borderRadius: graftRadius.sheet,
  },
  helper: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 10,
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
  intro: {
    marginBottom: graftSpacing.three,
    marginTop: 44,
    maxWidth: 520,
  },
  iosPasteHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: graftSpacing.three,
  },
  iosPasteHeaderSpacer: {
    width: 44,
  },
  iosPasteTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  iosPrimary: {
    marginTop: graftSpacing.two,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: graftSpacing.one,
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
  privacy: {
    fontSize: 12,
  },
  privacyRow: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: graftSpacing.three,
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
  scanPrimary: {
    alignItems: "center",
    borderRadius: graftRadius.medium,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    marginBottom: graftSpacing.two,
    minHeight: 52,
  },
  scanPrimaryText: {
    fontSize: 16.5,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  title: {
    fontSize: 42,
    fontWeight: "700",
    letterSpacing: -1.8,
    lineHeight: 45,
  },
});
