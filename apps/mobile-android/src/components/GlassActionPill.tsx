import { Host, HStack, Image, ProgressView, Spacer, Text, ZStack } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  frame,
  glassEffect,
  kerning,
  opacity,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { ActivityIndicator, StyleSheet, Text as RNText, View } from "react-native";

import { canUseLiquidGlass, iosSystemNameForIcon } from "../chrome/liquidGlass";
import { graftRadius } from "../theme/tokens";
import { PressScale } from "./PressScale";

interface GlassActionPillProps {
  readonly accessibilityLabel?: string;
  readonly disabled?: boolean;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly isBusy?: boolean;
  readonly onPress: () => void;
  readonly title: string;
}

/// Full-width black-glass action pill — native `GlassActionPill` anatomy:
/// icon pinned left, label centered, 56pt capsule, 0.97 press scale.
/// iOS uses `@expo/ui` `glassEffect` in a capsule (same API as toolbar
/// circles). Do not wrap that glass in `overflow: hidden` or an opaque tint.
export function GlassActionPill({
  accessibilityLabel,
  disabled = false,
  icon,
  isBusy = false,
  onPress,
  title,
}: GlassActionPillProps) {
  const blocked = disabled || isBusy;
  const systemName = iosSystemNameForIcon(icon);

  if (canUseLiquidGlass() && systemName) {
    return (
      <PressScale
        accessibilityLabel={accessibilityLabel ?? title}
        disabled={blocked}
        onPress={onPress}
        style={styles.pill}
      >
        <Host colorScheme="dark" style={StyleSheet.absoluteFill}>
          <ZStack
            modifiers={[
              frame({ height: 56, maxWidth: Number.POSITIVE_INFINITY }),
              glassEffect({
                glass: { interactive: true, variant: "regular" },
                shape: "capsule",
              }),
              opacity(blocked ? 0.45 : 1),
            ]}
          >
            {isBusy ? (
              <ProgressView modifiers={[tint("#FFFFFF")]} />
            ) : (
              <Text
                modifiers={[
                  foregroundStyle("#FFFFFF"),
                  font({ size: 16.5, weight: "semibold" }),
                  kerning(-0.3),
                ]}
              >
                {title}
              </Text>
            )}
            <HStack
              modifiers={[
                frame({
                  alignment: "leading",
                  maxWidth: Number.POSITIVE_INFINITY,
                }),
                padding({ leading: 22 }),
              ]}
            >
              <Image
                color="#FFFFFF"
                size={17}
                systemName={systemName as NonNullable<ComponentProps<typeof Image>["systemName"]>}
              />
              <Spacer />
            </HStack>
          </ZStack>
        </Host>
      </PressScale>
    );
  }

  return (
    <PressScale
      accessibilityLabel={accessibilityLabel ?? title}
      disabled={blocked}
      onPress={onPress}
    >
      <View style={[styles.pill, styles.fallback]}>
        <View style={styles.row}>
          <Ionicons color="#FFFFFF" name={icon} size={17} style={styles.leadingIcon} />
          {isBusy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <RNText style={styles.title}>{title}</RNText>
          )}
        </View>
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: "#09090B",
    borderRadius: graftRadius.pill,
  },
  leadingIcon: {
    left: 22,
    position: "absolute",
  },
  pill: {
    alignItems: "center",
    height: 56,
    justifyContent: "center",
    width: "100%",
  },
  row: {
    alignItems: "center",
    height: 56,
    justifyContent: "center",
    width: "100%",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 16.5,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
});
