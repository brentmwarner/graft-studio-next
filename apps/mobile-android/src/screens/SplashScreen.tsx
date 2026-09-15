import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";

import { GraftGlassMark } from "../components/GraftGlassMark";
import { Wordmark } from "../components/Wordmark";
import { graftSpacing, useGraftPalette } from "../theme/tokens";

export function SplashScreen() {
  const palette = useGraftPalette();

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {Platform.OS === "ios" ? (
        <>
          <GraftGlassMark size={88} />
          <Text style={[styles.brand, { color: palette.foreground }]}>Graft</Text>
        </>
      ) : (
        <Wordmark />
      )}
      <ActivityIndicator color={palette.foregroundSubtle} size="small" />
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: -0.5,
  },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: graftSpacing.three,
  },
});
