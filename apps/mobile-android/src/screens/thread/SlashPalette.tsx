import type { GraftComposerCommand } from "@graft/mobile-contract";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { FloatingSurface } from "../../components/FloatingSurface";
import { PressScale } from "../../components/PressScale";
import { useGraftPalette } from "../../theme/tokens";

export function SlashPalette({
  query,
  threadId,
  providerId,
  loadCommands,
  onPick,
}: {
  readonly query: string;
  readonly threadId: string;
  readonly providerId: string | undefined;
  readonly loadCommands: (threadId: string) => Promise<readonly GraftComposerCommand[]>;
  readonly onPick: (command: GraftComposerCommand) => void;
}) {
  const palette = useGraftPalette();
  const [commands, setCommands] = useState<readonly GraftComposerCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setCommands([]);
    setError(undefined);
    void loadCommands(threadId).then(
      (result) => {
        if (active) {
          setCommands(result);
          setLoading(false);
        }
      },
      () => {
        if (active) {
          setError("Commands could not load. Reopen / to retry.");
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [loadCommands, threadId, providerId]);
  const term = query.slice(1).toLowerCase();
  const matches = commands.filter((command) =>
    `${command.name} ${command.description}`.toLowerCase().includes(term),
  );
  return (
    <FloatingSurface style={styles.surface}>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
        {loading || error || matches.length === 0 ? (
          <Text style={[styles.status, { color: palette.foregroundMuted }]}>
            {error ?? (loading ? "Loading commands…" : "No matching commands")}
          </Text>
        ) : null}
        {matches.map((command) => (
          <PressScale
            key={command.name}
            accessibilityLabel={`/${command.name}: ${command.description}`}
            onPress={() => onPick(command)}
          >
            <View style={styles.row}>
              <Text style={[styles.name, { color: palette.foreground }]}>/{command.name}</Text>
              <Text
                numberOfLines={2}
                style={[styles.description, { color: palette.foregroundMuted }]}
              >
                {command.description}
              </Text>
            </View>
          </PressScale>
        ))}
      </ScrollView>
    </FloatingSurface>
  );
}

const styles = StyleSheet.create({
  surface: { borderRadius: 22, overflow: "hidden" },
  scroll: { maxHeight: 264 },
  row: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 10, gap: 4 },
  name: { fontSize: 15, fontWeight: "600" },
  description: { fontSize: 13 },
  status: { padding: 16, fontSize: 14 },
});
