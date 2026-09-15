import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FloatingSurface } from "../components/FloatingSurface";
import { PressScale } from "../components/PressScale";
import { graftRadius, graftSpacing, useGraftPalette } from "../theme/tokens";

interface QrScannerProps {
  readonly onClose: () => void;
  readonly onPasteInstead?: () => void;
  readonly onScan: (value: string) => void;
}

/// Quiet full-screen pairing scan — live camera, not a sheet. Permission is
/// requested on mount so the surface never sits as an empty black drawer.
export function QrScanner({ onClose, onPasteInstead, onScan }: QrScannerProps) {
  const palette = useGraftPalette();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [didScan, setDidScan] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [mountError, setMountError] = useState<string>();

  useEffect(() => {
    if (!permission) return;
    if (permission.granted || !permission.canAskAgain) return;
    void requestPermission();
  }, [permission, requestPermission]);

  if (!permission || (!permission.granted && permission.canAskAgain)) {
    return (
      <View style={[styles.fill, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.foreground} />
        <Text style={[styles.preparing, { color: palette.foregroundMuted }]}>
          Preparing camera…
        </Text>
      </View>
    );
  }

  if (!permission.granted || mountError) {
    return (
      <View style={[styles.permission, { backgroundColor: palette.background }]}>
        <Ionicons color={palette.foreground} name="scan" size={42} />
        <Text style={[styles.permissionTitle, { color: palette.foreground }]}>
          {mountError ? "Scanner unavailable" : "Camera access needed"}
        </Text>
        <Text style={[styles.permissionBody, { color: palette.foregroundSubtle }]}>
          {mountError ??
            "Allow camera access to scan the pairing code on your computer, or paste the link instead."}
        </Text>
        {permission.canAskAgain && !mountError ? (
          <PressScale
            accessibilityLabel="Allow camera access"
            onPress={() => void requestPermission()}
            style={[styles.permissionButton, { backgroundColor: palette.foreground }]}
          >
            <Text style={{ color: palette.background, fontWeight: "700" }}>Allow camera</Text>
          </PressScale>
        ) : null}
        {onPasteInstead ? (
          <PressScale
            accessibilityLabel="Paste the pairing link instead"
            onPress={onPasteInstead}
            style={styles.cancelButton}
          >
            <Text style={{ color: palette.foreground, fontWeight: "600" }}>
              Paste the link instead
            </Text>
          </PressScale>
        ) : null}
        <PressScale accessibilityLabel="Close camera" onPress={onClose} style={styles.cancelButton}>
          <Text style={{ color: palette.foregroundMuted }}>Cancel</Text>
        </PressScale>
      </View>
    );
  }

  return (
    <View accessibilityLabel="QR code scanner" style={styles.black}>
      <CameraView
        active
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        facing="back"
        mute
        onBarcodeScanned={
          didScan
            ? undefined
            : ({ data }) => {
                if (!data.trim()) return;
                setDidScan(true);
                onScan(data);
              }
        }
        onCameraReady={() => setIsReady(true)}
        onMountError={({ message }) => {
          setMountError(message || "The camera scanner is not available right now.");
        }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.scrim} />
      <PressScale
        accessibilityLabel="Close QR scanner"
        onPress={onClose}
        style={[styles.close, { top: insets.top + graftSpacing.one }]}
      >
        <FloatingSurface style={styles.closeSurface}>
          <Ionicons color="#FFFFFF" name="close" size={24} />
        </FloatingSurface>
      </PressScale>
      <View pointerEvents="box-none" style={styles.scannerContent}>
        <Text style={styles.scannerTitle}>Scan the pairing code</Text>
        <View style={styles.reticle} />
        {!isReady ? (
          <Text style={styles.scannerHint}>Starting camera…</Text>
        ) : (
          <Text style={styles.scannerHint}>
            Open Graft Studio on your computer and show its mobile pairing QR code.
          </Text>
        )}
        {onPasteInstead ? (
          <PressScale
            accessibilityLabel="Paste the pairing link instead"
            onPress={onPasteInstead}
            style={styles.pasteInstead}
          >
            <Text style={styles.pasteInsteadText}>Paste the link instead</Text>
          </PressScale>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  black: {
    backgroundColor: "#000000",
    flex: 1,
  },
  cancelButton: {
    justifyContent: "center",
    minHeight: 44,
  },
  close: {
    position: "absolute",
    right: graftSpacing.two,
    zIndex: 2,
  },
  closeSurface: {
    alignItems: "center",
    backgroundColor: "rgba(12, 12, 14, 0.72)",
    borderColor: "rgba(255, 255, 255, 0.16)",
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  fill: {
    alignItems: "center",
    flex: 1,
    gap: graftSpacing.two,
    justifyContent: "center",
  },
  pasteInstead: {
    marginTop: graftSpacing.one,
    minHeight: 44,
    justifyContent: "center",
  },
  pasteInsteadText: {
    color: "rgba(255, 255, 255, 0.92)",
    fontSize: 15,
    fontWeight: "600",
  },
  permission: {
    alignItems: "center",
    flex: 1,
    gap: graftSpacing.two,
    justifyContent: "center",
    padding: graftSpacing.four,
  },
  permissionBody: {
    fontSize: 16,
    lineHeight: 23,
    maxWidth: 320,
    textAlign: "center",
  },
  permissionButton: {
    alignItems: "center",
    borderRadius: graftRadius.pill,
    justifyContent: "center",
    marginTop: graftSpacing.one,
    minHeight: 50,
    minWidth: 180,
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  preparing: {
    fontSize: 16,
  },
  reticle: {
    borderColor: "rgba(255, 255, 255, 0.92)",
    borderRadius: graftRadius.large,
    borderWidth: 3,
    height: 248,
    width: 248,
  },
  scannerContent: {
    alignItems: "center",
    bottom: 0,
    gap: graftSpacing.three,
    justifyContent: "center",
    left: 0,
    paddingHorizontal: graftSpacing.three,
    position: "absolute",
    right: 0,
    top: 0,
  },
  scannerHint: {
    color: "rgba(255, 255, 255, 0.76)",
    fontSize: 15,
    lineHeight: 21,
    maxWidth: 310,
    textAlign: "center",
  },
  scannerTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0, 0, 0, 0.18)",
  },
});
