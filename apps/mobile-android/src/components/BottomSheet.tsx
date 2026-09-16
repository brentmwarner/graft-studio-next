import { Ionicons } from "@expo/vector-icons";
import type { PropsWithChildren, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { graftRadius, useGraftPalette } from "../theme/tokens";
import { PressScale } from "./PressScale";

/// UIKit sheets rise on a spring while the dimming view cross-fades. RN's
/// `animationType="slide"` slides the *whole* modal — scrim included — which
/// reads as the backdrop sliding up with the card.
const SHEET_SPRING = { dampingRatio: 0.9, duration: 320 } as const;
const DISMISS_MS = 220;
/// Past this much drag (or this much flick velocity) the sheet commits to
/// closing instead of springing back.
const DISMISS_DISTANCE = 90;
const DISMISS_VELOCITY = 0.7;

interface BottomSheetProps extends PropsWithChildren {
  readonly maxHeightRatio?: number;
  readonly onClose: () => void;
  readonly title: string;
  readonly visible: boolean;
  /// Rendered in place of the close button — used by Settings for its "Done".
  readonly trailingAccessory?: ReactNode;
}

export function BottomSheet({
  children,
  maxHeightRatio = 0.78,
  onClose,
  title,
  trailingAccessory,
  visible,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const palette = useGraftPalette();

  // Kept mounted through the dismiss animation — unmounting on `visible=false`
  // is what made the old sheets vanish instantly with no exit motion.
  const [isMounted, setIsMounted] = useState(visible);
  const progress = useSharedValue(0);
  const sheetHeight = useSharedValue(0);
  const measuredHeight = useRef(0);

  useEffect(() => {
    if (visible) {
      setIsMounted(true);
      progress.value = withSpring(1, SHEET_SPRING);
      return;
    }
    progress.value = withTiming(0, { duration: DISMISS_MS }, (finished) => {
      if (finished) runOnJS(setIsMounted)(false);
    });
  }, [progress, visible]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 4,
        onPanResponderMove: (_event, gesture) => {
          if (gesture.dy <= 0 || measuredHeight.current <= 0) return;
          progress.value = Math.max(0, 1 - gesture.dy / measuredHeight.current);
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) {
            onClose();
            return;
          }
          progress.value = withSpring(1, SHEET_SPRING);
        },
        onPanResponderTerminate: () => {
          progress.value = withSpring(1, SHEET_SPRING);
        },
      }),
    [onClose, progress],
  );

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * sheetHeight.value }],
  }));

  function handleSheetLayout(event: LayoutChangeEvent) {
    const { height } = event.nativeEvent.layout;
    measuredHeight.current = height;
    sheetHeight.value = height;
  }

  if (!isMounted) return null;

  return (
    <Modal animationType="none" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <View style={styles.root}>
        <Animated.View style={[styles.scrim, { backgroundColor: palette.scrim }, scrimStyle]}>
          <Pressable
            accessibilityLabel="Close"
            accessibilityRole="button"
            onPress={onClose}
            style={styles.fill}
          />
        </Animated.View>

        <Animated.View
          onLayout={handleSheetLayout}
          style={[
            styles.sheet,
            {
              backgroundColor: palette.elevated,
              maxHeight: `${Math.round(maxHeightRatio * 100)}%`,
              paddingBottom: Math.max(insets.bottom, 14),
            },
            sheetStyle,
          ]}
        >
          <View {...panResponder.panHandlers}>
            <View style={[styles.grabber, { backgroundColor: palette.muted }]} />
            <View style={styles.header}>
              <Text style={[styles.title, { color: palette.foreground }]}>{title}</Text>
              {trailingAccessory ?? (
                <PressScale accessibilityLabel="Close" onPress={onClose}>
                  <View style={[styles.close, { backgroundColor: palette.subtle }]}>
                    <Ionicons color={palette.foregroundMuted} name="close" size={18} />
                  </View>
                </PressScale>
              )}
            </View>
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  fill: { flex: 1 },
  scrim: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  sheet: {
    borderTopLeftRadius: graftRadius.sheet,
    borderTopRightRadius: graftRadius.sheet,
    minHeight: 250,
    overflow: "hidden",
  },
  grabber: {
    alignSelf: "center",
    borderRadius: 3,
    height: 5,
    marginTop: 8,
    width: 38,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 8,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  title: { fontSize: 18, fontWeight: "700" },
  close: {
    alignItems: "center",
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
});
