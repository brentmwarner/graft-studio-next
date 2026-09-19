import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { PressScale } from "../../components/PressScale";
import { useGraftPalette } from "../../theme/tokens";
import { ComposerConfigMenu, type ComposerMenuConfig } from "./ComposerConfigMenu";
import { displayName } from "./displayName";

/** One compact model/effort control inside the composer, including before catalog loading. */
export function ComposerSettings({
  config,
  modelName,
  modelMenuRequest,
}: {
  readonly config: ComposerMenuConfig;
  readonly modelName?: string;
  readonly modelMenuRequest?: number;
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
            <Text
              numberOfLines={1}
              ellipsizeMode="middle"
              style={[styles.label, { color: palette.foreground }]}
            >
              {label}
              {effort ? <Text style={{ color: palette.foregroundMuted }}> {effort}</Text> : null}
            </Text>
          </PressScale>
        )}
      />
    </View>
  );
}

export function ComposerPermissions({
  config,
  label,
  elevated,
}: {
  readonly config: ComposerMenuConfig;
  readonly label: string;
  readonly elevated: boolean;
}) {
  const palette = useGraftPalette();
  if (!config.approvalOptions.length) return null;
  return (
    <ComposerConfigMenu
      config={config}
      initialPage="permissions"
      trigger={(open) => (
        <PressScale
          accessibilityLabel={`Permissions: ${label}`}
          disabled={config.approvalOptions.length < 2}
          onPress={open}
          style={styles.permissions}
        >
          <Ionicons
            color={elevated ? palette.warning : palette.foregroundMuted}
            name="shield-checkmark-outline"
            size={18}
          />
        </PressScale>
      )}
    />
  );
}

const styles = StyleSheet.create({
  model: { flex: 1, minWidth: 0 },
  modelButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    minHeight: 48,
    paddingHorizontal: 6,
  },
  permissions: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  label: { flexShrink: 1, minWidth: 0, fontSize: 13, fontWeight: "500" },
});
