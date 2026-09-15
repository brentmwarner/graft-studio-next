import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { AnchoredMenu, MenuItem } from "../../components/AnchoredMenu";
import { PressScale } from "../../components/PressScale";
import { useGraftPalette } from "../../theme/tokens";
import { canAddAttachments } from "./composerAttachments";
import type { ComposerAttachmentState } from "./useComposerAttachments";

export function ComposerAttachMenu({
  attach,
  compact,
}: {
  readonly attach: ComposerAttachmentState;
  readonly compact?: boolean;
}) {
  const palette = useGraftPalette();
  const enabled = canAddAttachments(attach.attachments.length);

  return (
    <AnchoredMenu
      trigger={(open) => (
        <PressScale accessibilityLabel="Add attachment" disabled={!enabled} onPress={open}>
          <View style={compact ? styles.compact : styles.button}>
            <Ionicons color={palette.foreground} name="add" size={compact ? 22 : 28} />
          </View>
        </PressScale>
      )}
    >
      {(close) => (
        <>
          <MenuItem
            enabled={enabled}
            label="Photos"
            onPress={() => {
              close();
              void attach.pickPhotos();
            }}
          />
          <MenuItem
            enabled={enabled}
            label="Camera"
            onPress={() => {
              close();
              void attach.pickCamera();
            }}
          />
          <MenuItem
            enabled={enabled}
            label="Files"
            onPress={() => {
              close();
              void attach.pickFiles();
            }}
          />
          <MenuItem
            enabled={enabled}
            label="Paste"
            onPress={() => {
              close();
              void attach.paste();
            }}
          />
        </>
      )}
    </AnchoredMenu>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  compact: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32,
  },
});
