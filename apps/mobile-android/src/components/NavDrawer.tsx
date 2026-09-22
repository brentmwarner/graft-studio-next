import { Ionicons } from "@expo/vector-icons";
import type { PropsWithChildren } from "react";
import { useEffect, useMemo, useRef } from "react";
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { GatewayConnectionState } from "../api/gatewaySocket";
import { ThreadActivityIndicator } from "./ThreadActivityIndicator";
import type { InboxThreadItem } from "../state/mobileViewModels";
import { useGraftPalette } from "../theme/tokens";

/// How far the content slides — which is also the revealed menu width.
/// Matches `NavDrawerLayout.menuWidth` on iOS.
const MENU_WIDTH = 300;
/// Corner radius the slid-aside content rounds to, from `NavDrawerLayout`.
const OPEN_RADIUS = 34;
/// Width of the left-edge strip that starts an open drag. Taps fall through it
/// to whatever is underneath; only a horizontal drag claims the responder.
const EDGE_GRAB_WIDTH = 24;
/// SwiftUI `.snappy(duration: 0.3)` is a spring with a slight bounce.
const SPRING = { dampingRatio: 0.85, duration: 300 } as const;
/// How much release velocity counts toward the open/close decision.
const VELOCITY_PROJECTION = 0.15;

export interface DrawerComputer {
  readonly id: string;
  readonly label: string;
  readonly isActive: boolean;
  readonly isConnected: boolean;
}

interface NavDrawerLayoutProps extends PropsWithChildren {
  readonly computers?: readonly DrawerComputer[];
  readonly connectionState: GatewayConnectionState;
  readonly hostLabel: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onOpen: () => void;
  readonly onSelectComputer?: (environmentId: string) => void;
  readonly onSettings: () => void;
  readonly onProjects: () => void;
  readonly recentThreads: readonly InboxThreadItem[];
  readonly onSelectThread: (thread: InboxThreadItem) => void;
}

interface DrawerRowProps {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly onPress?: () => void;
  readonly trailing?: React.ReactNode;
}

function DrawerRow({ icon, label, onPress, trailing }: DrawerRowProps) {
  const palette = useGraftPalette();
  const content = (
    <View style={styles.row}>
      <Ionicons color={palette.foreground} name={icon} size={21} style={styles.rowIcon} />
      <Text numberOfLines={1} style={[styles.rowLabel, { color: palette.foreground }]}>
        {label}
      </Text>
      {trailing}
    </View>
  );

  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {({ pressed }) => <View style={{ opacity: pressed ? 0.55 : 1 }}>{content}</View>}
    </Pressable>
  ) : (
    content
  );
}

/// Codex-style navigation drawer, layered *under* the main content: the menu
/// column is pinned to the leading edge and the whole screen — top bar
/// included — slides trailing to reveal it. A port of the iOS
/// `NavDrawerLayout`, so it must wrap the routed content rather than sit
/// inside one screen; an overlay panel would leave the top bar behind and
/// read as a different product.
export function NavDrawerLayout({
  children,
  computers,
  connectionState,
  hostLabel,
  isOpen,
  onClose,
  onOpen,
  onSelectComputer,
  onSettings,
  onProjects,
  recentThreads,
  onSelectThread,
}: NavDrawerLayoutProps) {
  const insets = useSafeAreaInsets();
  const palette = useGraftPalette();
  const isConnected = connectionState === "connected";
  const computerRows =
    computers && computers.length > 0
      ? computers
      : [{ id: hostLabel, label: hostLabel, isActive: true, isConnected }];

  /// 0 closed, 1 fully open. Driven by `isOpen` normally, and taken over
  /// directly while a drag is in flight so the panel tracks the finger.
  const progress = useSharedValue(0);
  const isOpenRef = useRef(isOpen);
  const dragOrigin = useRef(0);

  useEffect(() => {
    isOpenRef.current = isOpen;
    progress.value = withSpring(isOpen ? 1 : 0, SPRING);
  }, [isOpen, progress]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Never claim on touch-down: the edge strip overlaps real controls
        // (the thread back button), and a tap must reach them.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) => {
          if (Math.abs(gesture.dx) < 8) return false;
          // Let vertical scrolling win outright.
          if (Math.abs(gesture.dy) > Math.abs(gesture.dx)) return false;
          return isOpenRef.current ? gesture.dx < 0 : gesture.dx > 0;
        },
        onPanResponderGrant: () => {
          dragOrigin.current = isOpenRef.current ? 1 : 0;
        },
        onPanResponderMove: (_event, gesture) => {
          const next = dragOrigin.current + gesture.dx / MENU_WIDTH;
          progress.value = Math.min(1, Math.max(0, next));
        },
        onPanResponderRelease: (_event, gesture) => {
          const projected = progress.value + gesture.vx * VELOCITY_PROJECTION;
          const shouldOpen = projected > 0.5;
          progress.value = withSpring(shouldOpen ? 1 : 0, SPRING);
          if (shouldOpen !== isOpenRef.current) {
            isOpenRef.current = shouldOpen;
            if (shouldOpen) onOpen();
            else onClose();
          }
        },
        onPanResponderTerminate: () => {
          progress.value = withSpring(isOpenRef.current ? 1 : 0, SPRING);
        },
      }),
    [onClose, onOpen, progress],
  );

  const contentStyle = useAnimatedStyle(() => ({
    borderRadius: progress.value * OPEN_RADIUS,
    transform: [{ translateX: progress.value * MENU_WIDTH }],
  }));

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <View
        accessibilityElementsHidden={!isOpen}
        importantForAccessibility={isOpen ? "auto" : "no-hide-descendants"}
        pointerEvents={isOpen ? "auto" : "none"}
        style={[
          styles.menu,
          {
            paddingBottom: Math.max(insets.bottom, 16),
            paddingTop: insets.top + 24,
          },
        ]}
      >
        <Text style={[styles.brand, { color: palette.foreground }]}>Graft</Text>
        <DrawerRow icon="folder-outline" label="Projects" onPress={onProjects} />
        {computerRows.map((computer) => (
          <DrawerRow
            key={computer.id}
            icon="laptop-outline"
            label={computer.label}
            onPress={
              computer.isActive || !onSelectComputer
                ? undefined
                : () => onSelectComputer(computer.id)
            }
            trailing={
              <View
                accessibilityLabel={
                  computer.isActive
                    ? computer.isConnected
                      ? "Connected"
                      : "Disconnected"
                    : "Paired"
                }
                style={[
                  styles.connectionDot,
                  {
                    backgroundColor: computer.isConnected
                      ? palette.success
                      : palette.foregroundSubtle,
                  },
                ]}
              />
            }
          />
        ))}
        <ScrollView
          style={styles.spacer}
          contentContainerStyle={{ paddingTop: 20, paddingBottom: 16 }}
        >
          <Text
            style={[
              styles.rowLabel,
              { color: palette.foregroundSubtle, paddingHorizontal: 24, paddingBottom: 8 },
            ]}
          >
            Recents
          </Text>
          {recentThreads.map((thread) => (
            <DrawerRow
              key={thread.id}
              icon="chatbubble-outline"
              label={thread.title}
              onPress={() => onSelectThread(thread)}
              trailing={<ThreadActivityIndicator activity={thread.activity} />}
            />
          ))}
        </ScrollView>
        <DrawerRow icon="settings-outline" label="Settings" onPress={onSettings} />
      </View>

      <Animated.View
        style={[styles.content, { backgroundColor: palette.background }, contentStyle]}
      >
        {children}

        {isOpen ? (
          // Invisible layer over the slid-aside screen: tap or swipe it back
          // closed, exactly like the iOS `DrawerDismissScrim`.
          <Pressable
            accessibilityLabel="Close menu"
            accessibilityRole="button"
            onPress={onClose}
            style={styles.dismissScrim}
            {...panResponder.panHandlers}
          />
        ) : (
          <View
            {...panResponder.panHandlers}
            style={styles.edgeGrabber}
            // Taps pass through to the controls underneath; only horizontal
            // drags become the responder.
            pointerEvents="box-none"
          />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  menu: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
    width: MENU_WIDTH,
  },
  content: {
    // The shadow only ever reads once the content has slid trailing; at rest
    // it sits off-screen past the leading edge. Mirrors the iOS
    // `.shadow(color: .black.opacity(0.25), radius: 30, x: -4)`.
    boxShadow: "-4px 0px 30px rgba(0, 0, 0, 0.25)",
    flex: 1,
    overflow: "hidden",
  },
  dismissScrim: {
    backgroundColor: "rgba(0, 0, 0, 0.02)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  edgeGrabber: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
    width: EDGE_GRAB_WIDTH,
  },
  brand: {
    fontSize: 23,
    fontWeight: "700",
    letterSpacing: -0.5,
    paddingBottom: 20,
    paddingHorizontal: 24,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 49,
    paddingHorizontal: 24,
    paddingVertical: 13,
  },
  rowIcon: { marginRight: 14, textAlign: "center", width: 26 },
  rowLabel: { flex: 1, fontSize: 16, fontWeight: "500" },
  connectionDot: { borderRadius: 4, height: 8, width: 8 },
  spacer: { flex: 1 },
});
