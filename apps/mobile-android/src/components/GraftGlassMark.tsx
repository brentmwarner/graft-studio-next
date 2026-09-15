import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { canUseLiquidGlass } from "../chrome/liquidGlass";
import { FloatingSurface } from "./FloatingSurface";

/// Native `GraftGlassMark`: branch glyph on a 108pt black-glass disc.
export function GraftGlassMark({ size = 108 }: { readonly size?: number }) {
  const glyph = Math.round(size * 0.41);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: size, width: size }}
    >
      {canUseLiquidGlass() ? (
        <FloatingSurface
          interactive={false}
          style={[styles.disc, { borderRadius: size / 2, height: size, width: size }]}
          tintColor="#09090B"
        >
          <Ionicons color="#FFFFFF" name="git-branch-outline" size={glyph} />
        </FloatingSurface>
      ) : (
        <View style={[styles.disc, styles.fallback, { borderRadius: size / 2, height: size, width: size }]}>
          <Ionicons color="#FFFFFF" name="git-branch-outline" size={glyph} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: "center",
    justifyContent: "center",
  },
  fallback: {
    backgroundColor: "#09090B",
  },
});
