import type { GraftDiffSummary } from "@graft/mobile-contract";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { BottomSheet } from "../../components/BottomSheet";
import { useGraftPalette } from "../../theme/tokens";

export function DiffSheet({
  diff,
  onClose,
  visible,
}: {
  readonly diff?: GraftDiffSummary;
  readonly onClose: () => void;
  readonly visible: boolean;
}) {
  const palette = useGraftPalette();
  return (
    <BottomSheet onClose={onClose} title={diff?.title || "Changes"} visible={visible}>
      <ScrollView contentContainerStyle={styles.diffList}>
        {diff?.files.map((file) => (
          <View
            key={`${file.status}:${file.path}`}
            style={[styles.diffFile, { borderBottomColor: palette.border }]}
          >
            <View style={[styles.diffStatus, { backgroundColor: palette.subtle }]}>
              <Text style={[styles.diffStatusText, { color: palette.foregroundMuted }]}>
                {file.status.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <Text numberOfLines={2} style={[styles.diffPath, { color: palette.foreground }]}>
              {file.path}
            </Text>
            <Text style={[styles.diffAddition, { color: palette.success }]}>
              +{file.additions ?? 0}
            </Text>
            <Text style={{ color: palette.danger }}>−{file.deletions ?? 0}</Text>
          </View>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  diffList: { paddingBottom: 12, paddingHorizontal: 18 },
  diffFile: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    minHeight: 54,
  },
  diffStatus: {
    alignItems: "center",
    borderRadius: 6,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  diffStatusText: { fontFamily: "monospace", fontSize: 12, fontWeight: "700" },
  diffPath: { flex: 1, fontFamily: "monospace", fontSize: 12 },
  diffAddition: { marginLeft: 4 },
});
