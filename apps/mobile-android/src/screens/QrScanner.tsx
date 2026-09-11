import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FloatingSurface } from "../components/FloatingSurface";
import { PressScale } from "../components/PressScale";
import { graftRadius, graftSpacing, useGraftPalette } from "../theme/tokens";

interface QrScannerProps {
  readonly onClose: () => void;
  readonly onScan: (value: string) => void;
}

export function QrScanner({ onClose, onScan }: QrScannerProps) {
  const palette = useGraftPalette();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [didScan, setDidScan] = useState(false);

  if (!permission) return <View style={styles.black} />;

  if (!permission.granted) {
    return (
      <View style={[styles.permission, { backgroundColor: palette.background }]}>
        <Ionicons name="scan" color={palette.foreground} size={42} />
        <Text style={[styles.permissionTitle, { color: palette.foreground }]}>
          Camera access needed
        </Text>
        <Text style={[styles.permissionBody, { color: palette.foregroundSubtle }]}>
          Graft uses the camera only to scan the pairing code on your computer.
        </Text>
        <PressScale
          accessibilityLabel="Allow camera access"
          onPress={() => void requestPermission()}
          style={[styles.permissionButton, { backgroundColor: palette.foreground }]}
        >
          <Text style={{ color: palette.background, fontWeight: "700" }}>Allow camera</Text>
        </PressScale>
        <PressScale accessibilityLabel="Close camera" onPress={onClose} style={styles.cancelButton}>
          <Text style={{ color: palette.foregroundMuted }}>Cancel</Text>
        </PressScale>
      </View>
    );
  }

  return (
    <View style={styles.black}>
      <CameraView
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={
          didScan
            ? undefined
            : ({ data }) => {
                setDidScan(true);
                onScan(data);
              }
        }
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.scrim} />
      <PressScale
        accessibilityLabel="Close QR scanner"
        onPress={onClose}
        style={[styles.close, { top: insets.top + graftSpacing.one }]}
      >
        <FloatingSurface style={styles.closeSurface}>
          <Ionicons name="close" color="#FFFFFF" size={24} />
        </FloatingSurface>
      </PressScale>
      <View style={styles.scannerContent} pointerEvents="none">
        <Text style={styles.scannerTitle}>Scan the pairing code</Text>
        <View style={styles.reticle} />
        <Text style={styles.scannerHint}>
          Open Graft Studio on your computer and show its mobile pairing QR code.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  black: {
    flex: 1,
    backgroundColor: "#000000",
  },
  permission: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: graftSpacing.four,
    gap: graftSpacing.two,
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  permissionBody: {
    maxWidth: 320,
    textAlign: "center",
    fontSize: 16,
    lineHeight: 23,
  },
  permissionButton: {
    minHeight: 50,
    minWidth: 180,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: graftRadius.pill,
    marginTop: graftSpacing.one,
  },
  cancelButton: {
    minHeight: 44,
    justifyContent: "center",
  },
  scrim: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    backgroundColor: "rgba(0, 0, 0, 0.24)",
  },
  close: {
    position: "absolute",
    right: graftSpacing.two,
  },
  closeSurface: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12, 12, 14, 0.72)",
    borderColor: "rgba(255, 255, 255, 0.16)",
  },
  scannerContent: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: graftSpacing.three,
    gap: graftSpacing.three,
  },
  scannerTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  reticle: {
    width: 248,
    height: 248,
    borderRadius: graftRadius.large,
    borderWidth: 3,
    borderColor: "rgba(255, 255, 255, 0.92)",
  },
  scannerHint: {
    maxWidth: 310,
    color: "rgba(255, 255, 255, 0.76)",
    textAlign: "center",
    fontSize: 15,
    lineHeight: 21,
  },
});
