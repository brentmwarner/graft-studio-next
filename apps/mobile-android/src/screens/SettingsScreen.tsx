import type { GraftSessionCredential } from "@graft/mobile-contract";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { GatewayConnectionState } from "../api/gatewaySocket";
import { BottomSheet } from "../components/BottomSheet";
import { useGraftPalette } from "../theme/tokens";

const APP_VERSION = "0.1.0";

interface SettingsScreenProps {
  readonly connectionState: GatewayConnectionState;
  readonly onAddComputer: () => void;
  readonly onActivate: (environmentId: string) => void;
  readonly onClose: () => void;
  readonly onUnpair: (environmentId?: string) => Promise<void>;
  readonly session: GraftSessionCredential;
  readonly sessions: readonly GraftSessionCredential[];
  readonly visible: boolean;
}

/// Section headers use `PlainHeader` on iOS — `.textCase(nil)`, so sentence
/// case, never the shouty grouped-list default.
function SectionHeader({ title }: { readonly title: string }) {
  const palette = useGraftPalette();
  return <Text style={[styles.sectionHeader, { color: palette.foreground }]}>{title}</Text>;
}

export function SettingsScreen({
  connectionState,
  onAddComputer,
  onActivate,
  onClose,
  onUnpair,
  session,
  sessions,
  visible,
}: SettingsScreenProps) {
  const palette = useGraftPalette();
  const computers = sessions.length > 0 ? sessions : [session];

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
          {computers.map((computer, index) => {
            const isActive = computer.environmentId === session.environmentId;
            const isConnected = isActive && connectionState === "connected";
            return (
              <View key={computer.environmentId}>
                {index > 0 ? (
                  <View style={[styles.separator, { backgroundColor: palette.border }]} />
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  disabled={isActive}
                  onPress={() => onActivate(computer.environmentId)}
                >
                  {({ pressed }) => (
                    <View style={[styles.row, { opacity: pressed && !isActive ? 0.55 : 1 }]}>
                      <Text style={[styles.key, { color: palette.foreground }]}>
                        {isActive ? "Studio" : computer.environmentLabel}
                      </Text>
                      <View style={styles.hostValue}>
                        <View
                          accessibilityLabel={
                            isActive ? (isConnected ? "Connected" : "Disconnected") : "Paired"
                          }
                          style={[
                            styles.connectionDot,
                            {
                              backgroundColor: isConnected
                                ? palette.success
                                : palette.foregroundSubtle,
                            },
                          ]}
                        />
                        <Text
                          numberOfLines={1}
                          style={[styles.value, { color: palette.foregroundSubtle }]}
                        >
                          {computer.environmentLabel}
                        </Text>
                      </View>
                    </View>
                  )}
                </Pressable>
                <View style={[styles.separator, { backgroundColor: palette.border }]} />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    if (computers.length === 1) onClose();
                    void onUnpair(computer.environmentId);
                  }}
                >
                  {({ pressed }) => (
                    <View style={[styles.row, { opacity: pressed ? 0.55 : 1 }]}>
                      <Text style={[styles.key, { color: palette.danger }]}>
                        {computers.length > 1
                          ? `Disconnect ${computer.environmentLabel}`
                          : "Disconnect"}
                      </Text>
                    </View>
                  )}
                </Pressable>
              </View>
            );
          })}
          <View style={[styles.separator, { backgroundColor: palette.border }]} />
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onClose();
              onAddComputer();
            }}
          >
            {({ pressed }) => (
              <View style={[styles.row, { opacity: pressed ? 0.55 : 1 }]}>
                <Text style={[styles.key, { color: palette.accent }]}>Pair another computer</Text>
              </View>
            )}
          </Pressable>
        </View>

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
