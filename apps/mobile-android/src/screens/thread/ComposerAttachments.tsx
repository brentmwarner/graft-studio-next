import { Ionicons } from "@expo/vector-icons";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";

import { PressScale } from "../../components/PressScale";
import { useGraftPalette } from "../../theme/tokens";
import type { ComposerAttachment } from "./composerAttachmentSend";

export function ComposerAttachments({ attachments, disabled, onRemove }: {
  readonly attachments: readonly ComposerAttachment[];
  readonly disabled: boolean;
  readonly onRemove: (id: string) => void;
}) {
  const palette = useGraftPalette();
  if (!attachments.length) return null;
  return (
    <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.list}>
      {attachments.map((attachment) => (
        <View key={attachment.id} style={[styles.attachment, { backgroundColor: palette.subtle }]}>
          {attachment.type === "image" ? (
            <Image source={{ uri: attachment.uri }} style={styles.preview} accessibilityLabel={attachment.name} />
          ) : <Ionicons name="document-outline" size={24} color={palette.foregroundMuted} />}
          <View style={styles.copy}>
            <Text numberOfLines={1} style={[styles.name, { color: palette.foreground }]}>{attachment.name}</Text>
            <Text style={[styles.size, { color: palette.foregroundSubtle }]}>
              {attachment.sizeBytes < 1024 * 1024 ? `${Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB` : `${(attachment.sizeBytes / (1024 * 1024)).toFixed(1)} MB`}
            </Text>
          </View>
          <PressScale accessibilityLabel={`Remove ${attachment.name}`} disabled={disabled} onPress={() => onRemove(attachment.id)}>
            <View style={styles.remove}><Ionicons name="close" size={18} color={palette.foregroundMuted} /></View>
          </PressScale>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8, paddingHorizontal: 4 },
  attachment: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 16, paddingLeft: 10, paddingVertical: 6 },
  preview: { width: 36, height: 36, borderRadius: 8 },
  copy: { maxWidth: 150, gap: 2 },
  name: { fontSize: 12, fontWeight: "500" },
  size: { fontSize: 11 },
  remove: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
