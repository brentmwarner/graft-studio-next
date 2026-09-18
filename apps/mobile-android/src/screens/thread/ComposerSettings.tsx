import { StyleSheet, Text, View } from "react-native";

import { FloatingSurface } from "../../components/FloatingSurface";
import { PressScale } from "../../components/PressScale";
import { useGraftPalette } from "../../theme/tokens";
import { ComposerConfigMenu, type ComposerMenuConfig } from "./ComposerConfigMenu";
import { displayName } from "./displayName";

/** The same controls remain reachable before typing, during a draft, and after /model. */
export function ComposerSettings({
  config,
  modelName,
  modelMenuRequest,
  approvalLabel,
  approvalIsElevated,
}: {
  readonly config: ComposerMenuConfig;
  readonly modelName?: string;
  readonly modelMenuRequest?: number;
  readonly approvalLabel: string;
  readonly approvalIsElevated: boolean;
}) {
  const palette = useGraftPalette();
  const effort = config.resolvedEffort;
  return (
    <View style={styles.row}>
      <View style={styles.model}>
        <ComposerConfigMenu
          config={config}
          initialPage="providers"
          openRequest={modelMenuRequest}
          trigger={(open) => (
            <PressScale accessibilityLabel="Provider and model" onPress={open}>
              <FloatingSurface style={styles.pill}>
                <Text numberOfLines={1} style={[styles.label, { color: palette.foreground }]}>
                  {config.currentModel?.label ?? modelName?.replace("[1m]", "") ?? "Choose model"}
                </Text>
              </FloatingSurface>
            </PressScale>
          )}
        />
      </View>
      {effort ? (
        <ComposerConfigMenu
          config={config}
          initialPage="intelligence"
          trigger={(open) => (
            <PressScale accessibilityLabel="Reasoning effort" onPress={open}>
              <FloatingSurface style={styles.pill}>
                <Text style={[styles.label, { color: palette.foregroundMuted }]}>
                  {displayName(effort)}
                </Text>
              </FloatingSurface>
            </PressScale>
          )}
        />
      ) : null}
      {config.approvalOptions.length ? (
        <ComposerConfigMenu
          config={config}
          initialPage="permissions"
          trigger={(open) => (
            <PressScale
              accessibilityLabel="Permissions"
              disabled={config.approvalOptions.length < 2}
              onPress={open}
              style={styles.permissions}
            >
              <FloatingSurface style={styles.pill}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.label,
                    { color: approvalIsElevated ? palette.warning : palette.foregroundMuted },
                  ]}
                >
                  {approvalLabel}
                </Text>
              </FloatingSurface>
            </PressScale>
          )}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  model: { flex: 1, minWidth: 0 },
  permissions: { maxWidth: 112 },
  pill: { borderRadius: 22, minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  label: { fontSize: 12, fontWeight: "500" },
});
