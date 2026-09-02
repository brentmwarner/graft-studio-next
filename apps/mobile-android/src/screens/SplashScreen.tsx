import { ActivityIndicator, StyleSheet, View } from "react-native";

import { Wordmark } from "../components/Wordmark";
import { graftSpacing, useGraftPalette } from "../theme/tokens";

export function SplashScreen() {
  const palette = useGraftPalette();

  return (
    <View style={styles.container}>
      <Wordmark />
      <ActivityIndicator color={palette.foregroundSubtle} size="small" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: graftSpacing.three,
  },
});
