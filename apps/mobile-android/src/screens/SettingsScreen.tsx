import type { GraftSessionCredential } from "@graft/mobile-contract";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { GatewayConnectionState } from "../api/gatewaySocket";
import type { AccountAuth } from "../auth/useAccountAuth";
import { BottomSheet } from "../components/BottomSheet";
import { useGraftPalette } from "../theme/tokens";

const APP_VERSION = "0.1.0";

interface SettingsScreenProps {
  readonly account?: AccountAuth;
  readonly connectionState: GatewayConnectionState;
  readonly onClose: () => void;
  readonly onUnpair: () => Promise<void>;
  readonly session: GraftSessionCredential;
  readonly visible: boolean;
}

/// Section headers use `PlainHeader` on iOS — `.textCase(nil)`, so sentence
/// case, never the shouty grouped-list default.
function SectionHeader({ title }: { readonly title: string }) {
  const palette = useGraftPalette();
  return <Text style={[styles.sectionHeader, { color: palette.foreground }]}>{title}</Text>;
}

export function SettingsScreen({
  account,
  connectionState,
  onClose,
  onUnpair,
  session,
  visible,
}: SettingsScreenProps) {
  const palette = useGraftPalette();
  const isConnected = connectionState === "connected";

  return (
    <BottomSheet
      maxHeightRatio={0.9}
      onClose={onClose}
      title="Settings"
      trailingAccessory={
        <Pressable accessibilityRole="button" onPress={onClose}>
          {({ pressed }) => (
            <Text style={[styles.done, { color: palette.accent, opacity: pressed ? 0.55 : 1 }]}>
              Done
            </Text>
          )}
        </Pressable>
      }
      visible={visible}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Connection" />
        <View style={[styles.group, { backgroundColor: palette.subtle }]}>
          <View style={styles.row}>
            <Text style={[styles.key, { color: palette.foreground }]}>Studio</Text>
            <View style={styles.hostValue}>
              <View
                accessibilityLabel={isConnected ? "Connected" : "Disconnected"}
                style={[
                  styles.connectionDot,
                  {
                    backgroundColor: isConnected ? palette.success : palette.foregroundSubtle,
                  },
                ]}
              />
              <Text numberOfLines={1} style={[styles.value, { color: palette.foregroundSubtle }]}>
                {session.environmentLabel}
              </Text>
            </View>
          </View>
          <View style={[styles.separator, { backgroundColor: palette.border }]} />
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onClose();
              void onUnpair();
            }}
          >
            {({ pressed }) => (
              <View style={[styles.row, { opacity: pressed ? 0.55 : 1 }]}>
                <Text style={[styles.key, { color: palette.danger }]}>Disconnect</Text>
              </View>
            )}
          </Pressable>
        </View>

        {account?.isSignedIn && account.email ? (
          <>
            <SectionHeader title="Account" />
            <View style={[styles.group, { backgroundColor: palette.subtle }]}>
              <View style={styles.row}>
                <Text style={[styles.key, { color: palette.foreground }]}>Email</Text>
                <Text numberOfLines={1} style={[styles.value, { color: palette.foregroundSubtle }]}>
                  {account.email}
                </Text>
              </View>
              <View style={[styles.separator, { backgroundColor: palette.border }]} />
              <Pressable accessibilityRole="button" onPress={account.signOut}>
                {({ pressed }) => (
                  <View style={[styles.row, { opacity: pressed ? 0.55 : 1 }]}>
                    <Text style={[styles.key, { color: palette.danger }]}>Sign out</Text>
                  </View>
                )}
              </Pressable>
            </View>
          </>
        ) : null}

        <SectionHeader title="About" />
        <View style={[styles.group, { backgroundColor: palette.subtle }]}>
          <View style={styles.row}>
            <Text style={[styles.key, { color: palette.foreground }]}>Version</Text>
            <Text style={[styles.value, { color: palette.foregroundSubtle }]}>{APP_VERSION}</Text>
          </View>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 16, paddingHorizontal: 16 },
  done: { fontSize: 16, fontWeight: "600" },
  sectionHeader: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 22,
  },
  group: { borderRadius: 12, overflow: "hidden" },
  row: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  key: { flex: 1, fontSize: 16 },
  hostValue: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginLeft: 16,
    maxWidth: "58%",
  },
  connectionDot: { borderRadius: 4, height: 7, width: 7 },
  value: { flexShrink: 1, fontSize: 15 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
});
