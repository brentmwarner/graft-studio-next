import Ionicons from "@expo/vector-icons/Ionicons";
import { memo, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { TranscriptActivityItem } from "../state/mobileViewModels";
import { graftRadius, useGraftPalette } from "../theme/tokens";
import type { GraftPalette } from "../theme/tokens";

/// How much of a diff or command output the card will draw before it stops.
/// A 2000-line diff scrolled inline is unreadable on a phone and janks the
/// transcript's virtualization; the count tells you what you're not seeing.
const MAX_INLINE_LINES = 40;

type CardShellProps = {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly title: string;
  readonly meta?: React.ReactNode;
  /// Present means the card is expandable and this is what unfolds.
  readonly body?: React.ReactNode;
  readonly onPress?: () => void;
};

/// Every activity card is the same object: an icon, a title that can shrink,
/// optional trailing meta, and a body that unfolds on tap. Keeping the frame
/// in one place is what stops nine cards from drifting into nine dialects.
function CardShell({ icon, title, meta, body, onPress }: CardShellProps) {
  const palette = useGraftPalette();
  const [expanded, setExpanded] = useState(false);
  const interactive = Boolean(body) || Boolean(onPress);

  return (
    <View style={[styles.card, { backgroundColor: palette.subtle }]}>
      <Pressable
        accessibilityRole={interactive ? "button" : undefined}
        disabled={!interactive}
        onPress={onPress ?? (() => setExpanded((value) => !value))}
      >
        <View style={styles.header}>
          <Ionicons color={palette.foregroundSubtle} name={icon} size={16} />
          <Text numberOfLines={1} style={[styles.title, { color: palette.foreground }]}>
            {title}
          </Text>
          {meta}
          {body ? (
            <Ionicons
              color={palette.foregroundSubtle}
              name="chevron-forward"
              size={13}
              style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}
            />
          ) : null}
        </View>
      </Pressable>
      {expanded && body ? <View style={styles.body}>{body}</View> : null}
    </View>
  );
}

function MonoBlock({ text, palette }: { readonly text: string; readonly palette: GraftPalette }) {
  const lines = text.split("\n");
  const shown = lines.slice(0, MAX_INLINE_LINES);
  return (
    <View>
      <Text selectable style={[styles.mono, { color: palette.foregroundMuted }]}>
        {shown.join("\n")}
      </Text>
      {lines.length > shown.length ? (
        <Text style={[styles.truncation, { color: palette.foregroundSubtle }]}>
          {`${lines.length - shown.length} more lines`}
        </Text>
      ) : null}
    </View>
  );
}

/// Unified diff with per-line tinting. The green and red here are semantic —
/// they say "added" and "removed", not "good" and "bad".
function DiffBlock({ diff, palette }: { readonly diff: string; readonly palette: GraftPalette }) {
  const lines = diff.split("\n");
  const shown = lines.slice(0, MAX_INLINE_LINES);
  return (
    <View>
      {shown.map((line, index) => {
        const added = line.startsWith("+") && !line.startsWith("+++");
        const removed = line.startsWith("-") && !line.startsWith("---");
        return (
          <Text
            // Diff lines have no identity of their own — position is the only
            // key available, and the block is replaced wholesale on change.
            key={`${index}:${line}`}
            selectable
            style={[
              styles.diffLine,
              {
                color: added ? palette.success : removed ? palette.danger : palette.foregroundMuted,
                backgroundColor: added
                  ? palette.diffAddBackground
                  : removed
                    ? palette.diffRemoveBackground
                    : "transparent",
              },
            ]}
          >
            {line || " "}
          </Text>
        );
      })}
      {lines.length > shown.length ? (
        <Text style={[styles.truncation, { color: palette.foregroundSubtle }]}>
          {`${lines.length - shown.length} more lines`}
        </Text>
      ) : null}
    </View>
  );
}

function StatusDot({
  state,
  palette,
}: {
  readonly state: "pending" | "active" | "done";
  readonly palette: GraftPalette;
}) {
  if (state === "done") {
    return <Ionicons color={palette.foregroundSubtle} name="checkmark" size={14} />;
  }
  return (
    <View
      style={[
        styles.stepDot,
        state === "active"
          ? { backgroundColor: palette.foreground }
          : { borderColor: palette.foregroundSubtle, borderWidth: 1 },
      ]}
    />
  );
}

function fileName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function statusMeta(done: number, total: number): string {
  return `${done}/${total}`;
}

function ChecklistBody({
  items,
  palette,
}: {
  readonly items: readonly {
    readonly id: string;
    readonly label: string;
    readonly state: "pending" | "active" | "done";
  }[];
  readonly palette: GraftPalette;
}) {
  return (
    <View style={styles.list}>
      {items.map((item) => (
        <View key={item.id} style={styles.step}>
          <StatusDot palette={palette} state={item.state} />
          <Text
            style={[
              styles.stepText,
              {
                color: item.state === "done" ? palette.foregroundSubtle : palette.foregroundMuted,
              },
            ]}
          >
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

export const ActivityCard = memo(function ActivityCard({
  item,
}: {
  readonly item: TranscriptActivityItem;
}) {
  const palette = useGraftPalette();
  const data = item.data;

  // No structured payload — the host still guarantees readable text, and a
  // plain line beats a hole in the turn.
  if (!data) {
    return <Text style={[styles.plainNote, { color: palette.foregroundSubtle }]}>{item.text}</Text>;
  }

  switch (data.type) {
    case "file_edit":
      return (
        <CardShell
          body={data.diff ? <DiffBlock diff={data.diff} palette={palette} /> : undefined}
          icon="document-text-outline"
          meta={
            <View style={styles.diffStats}>
              <Text style={[styles.stat, { color: palette.success }]}>{`+${data.additions}`}</Text>
              <Text style={[styles.stat, { color: palette.danger }]}>{`−${data.deletions}`}</Text>
            </View>
          }
          title={fileName(data.filePath)}
        />
      );

    case "shell_command": {
      const failed = typeof data.exitCode === "number" && data.exitCode !== 0;
      return (
        <CardShell
          body={data.output ? <MonoBlock palette={palette} text={data.output} /> : undefined}
          icon="terminal-outline"
          meta={
            failed ? (
              <Text style={[styles.stat, { color: palette.danger }]}>
                {`exit ${data.exitCode}`}
              </Text>
            ) : undefined
          }
          title={data.command}
        />
      );
    }

    case "plan":
      return (
        <CardShell
          body={
            <ChecklistBody
              items={data.steps.map((step) => ({
                id: step.id,
                label: step.title,
                state: step.status,
              }))}
              palette={palette}
            />
          }
          icon="map-outline"
          meta={
            <Text style={[styles.stat, { color: palette.foregroundSubtle }]}>
              {statusMeta(
                data.steps.filter((step) => step.status === "done").length,
                data.steps.length,
              )}
            </Text>
          }
          title={data.title ?? "Plan"}
        />
      );

    case "todo_update":
      return (
        <CardShell
          body={
            <ChecklistBody
              items={data.todos.map((todo) => ({
                id: todo.id,
                label: todo.text,
                state:
                  todo.status === "completed"
                    ? "done"
                    : todo.status === "in_progress"
                      ? "active"
                      : "pending",
              }))}
              palette={palette}
            />
          }
          icon="checkbox-outline"
          meta={
            <Text style={[styles.stat, { color: palette.foregroundSubtle }]}>
              {statusMeta(
                data.todos.filter((todo) => todo.status === "completed").length,
                data.todos.length,
              )}
            </Text>
          }
          title="Todos"
        />
      );

    case "web_search": {
      const results = data.results ?? [];
      return (
        <CardShell
          body={
            results.length > 0 ? (
              <View style={styles.list}>
                {results.map((result) => (
                  <Pressable
                    accessibilityRole="link"
                    key={result.url}
                    onPress={() => {
                      void Linking.openURL(result.url).catch(() => {
                        // No browser, or a URL the OS refuses. The row stays
                        // put; nothing about the transcript is broken.
                      });
                    }}
                  >
                    <Text numberOfLines={2} style={[styles.resultTitle, { color: palette.info }]}>
                      {result.title}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.resultUrl, { color: palette.foregroundSubtle }]}
                    >
                      {result.url}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : undefined
          }
          icon="search-outline"
          meta={
            results.length > 0 ? (
              <Text style={[styles.stat, { color: palette.foregroundSubtle }]}>
                {results.length}
              </Text>
            ) : undefined
          }
          title={data.query}
        />
      );
    }

    case "sub_agent":
      return (
        <CardShell
          body={
            data.summary ? (
              <Text selectable style={[styles.bodyText, { color: palette.foregroundMuted }]}>
                {data.summary}
              </Text>
            ) : undefined
          }
          icon="git-branch-outline"
          meta={
            <Text
              style={[
                styles.stat,
                {
                  color: data.status === "failed" ? palette.danger : palette.foregroundSubtle,
                },
              ]}
            >
              {data.status === "running" ? "running" : data.status === "failed" ? "failed" : "done"}
            </Text>
          }
          title={data.name ?? "Agent"}
        />
      );

    case "artifact":
      return (
        <CardShell
          body={data.preview ? <MonoBlock palette={palette} text={data.preview} /> : undefined}
          icon="cube-outline"
          meta={
            data.mimeType ? (
              <Text style={[styles.stat, { color: palette.foregroundSubtle }]}>
                {data.mimeType.split("/").at(-1)}
              </Text>
            ) : undefined
          }
          title={data.title ?? "Artifact"}
        />
      );

    case "image":
      return (
        <CardShell
          body={
            data.base64Thumbnail ? (
              <Image
                accessibilityLabel={data.alt ?? "Image"}
                resizeMode="contain"
                source={{ uri: `data:image/png;base64,${data.base64Thumbnail}` }}
                style={styles.thumbnail}
              />
            ) : undefined
          }
          icon="image-outline"
          title={data.alt ?? (data.path ? fileName(data.path) : "Image")}
        />
      );

    // Tool, permission and question payloads reach the transcript through
    // their own rows and prompts — they never arrive as activity.
    default:
      return (
        <Text style={[styles.plainNote, { color: palette.foregroundSubtle }]}>{item.text}</Text>
      );
  }
});

const styles = StyleSheet.create({
  body: { gap: 6, paddingBottom: 10, paddingHorizontal: 12 },
  bodyText: { fontSize: 13, lineHeight: 19 },
  card: {
    borderRadius: graftRadius.medium,
    marginVertical: 3,
    overflow: "hidden",
  },
  diffLine: {
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 16,
    paddingHorizontal: 4,
  },
  diffStats: { flexDirection: "row", gap: 6 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  list: { gap: 8 },
  mono: { fontFamily: "monospace", fontSize: 11, lineHeight: 16 },
  plainNote: { fontSize: 13, paddingHorizontal: 4, paddingVertical: 6 },
  resultTitle: { fontSize: 13, lineHeight: 18 },
  resultUrl: { fontSize: 11, lineHeight: 15 },
  stat: { fontSize: 12, fontVariant: ["tabular-nums"] },
  step: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  stepDot: { borderRadius: 999, height: 8, marginTop: 5, width: 8 },
  stepText: { flex: 1, fontSize: 13, lineHeight: 19 },
  thumbnail: { borderRadius: graftRadius.small, height: 180, width: "100%" },
  title: { flex: 1, fontSize: 13 },
  truncation: { fontSize: 11, paddingTop: 4 },
});
