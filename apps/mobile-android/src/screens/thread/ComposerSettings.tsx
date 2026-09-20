import { StyleSheet, Text, View } from "react-native";

import { PressScale } from "../../components/PressScale";
import { ProviderLogo } from "../../components/ProviderLogo";
import { useGraftPalette } from "../../theme/tokens";
import { ComposerConfigMenu, type ComposerMenuConfig } from "./ComposerConfigMenu";
import { displayName } from "./displayName";

/** One compact model/effort control inside the composer, including before catalog loading. */
export function ComposerSettings({
  config,
  modelName,
  modelMenuRequest,
  showProviderIcon = false,
}: {
  readonly config: ComposerMenuConfig;
  readonly modelName?: string;
  readonly modelMenuRequest?: number;
  readonly showProviderIcon?: boolean;
}) {
  const palette = useGraftPalette();
  const label = config.currentModel?.label ?? modelName?.replace("[1m]", "") ?? "Choose model";
  const effort = config.resolvedEffort ? displayName(config.resolvedEffort) : undefined;
  return (
    <View style={styles.model}>
      <ComposerConfigMenu
        config={config}
        initialPage="intelligence"
        openRequest={modelMenuRequest}
        trigger={(open) => (
          <PressScale
            accessibilityLabel={`Model and reasoning effort: ${[label, effort].filter(Boolean).join(", ")}`}
            onPress={open}
            style={styles.modelButton}
          >
            {showProviderIcon ? (
              <ProviderLogo
                providerId={config.currentModel?.providerId ?? config.lockedProviderId}
                label={config.currentModel?.providerLabel}
                size={18}
              />
            ) : null}
            <Text
              numberOfLines={1}
              ellipsizeMode="middle"
              style={[styles.label, { color: palette.foreground }]}
            >
              {label}
            </Text>
          </PressScale>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  model: { flexShrink: 1, minWidth: 0 },
  modelButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    minHeight: 48,
    paddingHorizontal: 6,
  },
  label: { flexShrink: 1, minWidth: 0, fontSize: 13, fontWeight: "500" },
});
