import type { PropsWithChildren } from "react";
import { useState } from "react";
import type { AccessibilityRole, StyleProp, ViewStyle } from "react-native";
import { Pressable } from "react-native";
import Animated from "react-native-reanimated";

interface PressScaleProps extends PropsWithChildren {
  readonly accessibilityLabel: string;
  readonly accessibilityRole?: AccessibilityRole;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly style?: StyleProp<ViewStyle>;
}

/// The pressable IS the styled box. Splitting them — `Pressable` outside, a
/// styled `Animated.View` inside — silently breaks hit testing: an absolutely
/// positioned `style` takes the visible box out of flow, the `Pressable` around
/// it collapses to zero size, and Android never routes a touch to a zero-size
/// view (nor to anything painted outside its parent's bounds). One node keeps
/// the touch target and the layout box in lockstep.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressScale({
  accessibilityLabel,
  accessibilityRole = "button",
  children,
  disabled = false,
  onPress,
  style,
}: PressScaleProps) {
  const [pressed, setPressed] = useState(false);

  return (
    <AnimatedPressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        style,
        {
          opacity: disabled ? 0.45 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
          transitionDuration: "140ms",
          transitionProperty: ["transform", "opacity"],
          transitionTimingFunction: "ease-out",
        },
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}
