import { Ionicons } from "@expo/vector-icons";
import type { GraftDiffFileSummary, GraftDiffLine, GraftDiffSummary } from "@graft/mobile-contract";
import { Fragment, memo, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { AnchoredMenu, MenuItem } from "../../components/AnchoredMenu";
import { BottomSheet } from "../../components/BottomSheet";
import { MenuProvider } from "../../components/MenuProvider";
import { PressScale } from "../../components/PressScale";
import { graftRadius, useGraftPalette } from "../../theme/tokens";
import { useDiffFiles, type DiffFileState } from "./useDiffFiles";

const PAGE_LINES = 200;

const CodeLine = memo(function CodeLine({ line }: { readonly line: GraftDiffLine }) {
  const palette = useGraftPalette();
  const added = line.kind === "addition";
  const removed = line.kind === "deletion";
  const color = added ? palette.success : removed ? palette.danger : palette.foregroundSubtle;
  const number = removed ? line.oldLine : line.newLine;
  return (
    <View
      style={[
        styles.codeRow,
        {
          backgroundColor: added
            ? palette.diffAddBackground
            : removed
              ? palette.diffRemoveBackground
              : "transparent",
        },
      ]}
    >
      <Text
        accessible={false}
        style={[
          styles.lineNumber,
          { color, borderLeftColor: added || removed ? color : "transparent" },
        ]}
      >
        {number}
      </Text>
      <Text accessible={false} style={[styles.lineSign, { color }]}>
        {added ? "+" : removed ? "−" : " "}
      </Text>
      <Text
        accessibilityLabel={`${added ? "Added" : removed ? "Removed" : "Line"} ${number ?? ""}: ${line.text}`}
        style={[styles.code, { color: palette.foreground }]}
      >
        {line.tokens?.length
          ? line.tokens.map((token, index) => (
              <Text
                key={index}
                style={{
                  color:
                    (palette.isDark ? token.darkColor : token.lightColor) ?? palette.foreground,
                  backgroundColor: token.changed
                    ? added
                      ? palette.diffAddEmphasis
                      : palette.diffRemoveEmphasis
                    : "transparent",
                }}
              >
                {token.text}
              </Text>
            ))
          : line.text || " "}
      </Text>
    </View>
  );
});

function FileBody({
  file,
  state,
  onRetry,
}: {
  readonly file: GraftDiffFileSummary;
  readonly state: DiffFileState | undefined;
  readonly onRetry: () => void;
}) {
  const palette = useGraftPalette();
  const { width } = useWindowDimensions();
  const [limit, setLimit] = useState(PAGE_LINES);
  const detail = state?.file;
  const lines = detail?.hunks?.reduce((total, hunk) => total + hunk.lines.length, 0) ?? 0;
  if (!state || state.loading)
    return (
      <View style={styles.feedback}>
        <ActivityIndicator color={palette.foregroundMuted} />
        <Text style={{ color: palette.foregroundSubtle }}>Loading changes…</Text>
      </View>
    );
  if (state.failed || !detail?.detailStatus)
    return (
      <View style={styles.feedback}>
        <Text style={[styles.feedbackText, { color: palette.foregroundSubtle }]}>
          {state.failed
            ? "Changes couldn’t be loaded."
            : "Line changes aren’t available on this host yet."}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={[styles.retry, { backgroundColor: palette.subtle }]}
        >
          <Text style={{ color: palette.foreground }}>Try again</Text>
        </Pressable>
      </View>
    );
  if (lines === 0)
    return (
      <View style={styles.feedback}>
        <Text style={{ color: palette.foregroundSubtle }}>
          {detail.detailStatus === "truncated"
            ? "This file is too large to preview."
            : file.status === "renamed"
              ? `Renamed${detail.previousPath ? ` from ${detail.previousPath}` : ""}. No text changes.`
              : "Binary or metadata-only change."}
        </Text>
      </View>
    );

  let shown = 0;
  return (
    <View>
      {detail.previousPath ? (
        <Text style={[styles.previousPath, { color: palette.foregroundSubtle }]}>
          Renamed from {detail.previousPath}
        </Text>
      ) : null}
      <ScrollView
        horizontal
        directionalLockEnabled
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        contentContainerStyle={{ minWidth: width }}
      >
        <View style={{ minWidth: width, paddingBottom: 10 }}>
          {detail.hunks?.map((hunk, index) => {
            const visibleLines = hunk.lines.slice(0, Math.max(0, limit - shown));
            shown += visibleLines.length;
            if (!visibleLines.length) return null;
            return (
              <Fragment key={`${hunk.oldStart}:${hunk.newStart}:${index}`}>
                {hunk.collapsedBefore > 0 ? (
                  <View
                    style={[styles.gap, { backgroundColor: palette.subtle, width: width - 16 }]}
                  >
                    <Text style={[styles.gapText, { color: palette.foregroundSubtle }]}>
                      {hunk.collapsedBefore} unmodified{" "}
                      {hunk.collapsedBefore === 1 ? "line" : "lines"}
                    </Text>
                  </View>
                ) : null}
                {visibleLines.map((line, lineIndex) => (
                  <CodeLine
                    key={`${line.kind}:${line.oldLine}:${line.newLine}:${lineIndex}`}
                    line={line}
                  />
                ))}
              </Fragment>
            );
          })}
        </View>
      </ScrollView>
      {lines > limit ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setLimit((value) => value + PAGE_LINES)}
          style={[styles.more, { backgroundColor: palette.subtle }]}
        >
          <Text style={{ color: palette.foreground }}>
            Show {Math.min(PAGE_LINES, lines - limit)} more lines
          </Text>
        </Pressable>
      ) : null}
      {detail.detailStatus === "truncated" ? (
        <Text style={[styles.previousPath, { color: palette.foregroundSubtle }]}>
          Preview limited to the first {lines} lines. Open the full diff on your host.
        </Text>
      ) : null}
    </View>
  );
}

function DiffContent({
  diff,
  onLoadFile,
  onClose,
}: {
  readonly diff: GraftDiffSummary | undefined;
  readonly onLoadFile: (threadId: string, path: string) => Promise<GraftDiffSummary | undefined>;
  readonly onClose: () => void;
}) {
  const palette = useGraftPalette();
  const model = useDiffFiles(diff, true, onLoadFile);
  const { width } = useWindowDimensions();
  const count = diff?.files.length ?? 0;
  return (
    <View style={styles.flex}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <View style={styles.headerSpacer} />
        <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>
          {count} {count === 1 ? "file" : "files"} changed
        </Text>
        <AnchoredMenu
          trigger={(open) => (
            <PressScale accessibilityLabel="Diff options" onPress={open} style={styles.menuButton}>
              <Ionicons name="ellipsis-vertical" size={20} color={palette.foreground} />
            </PressScale>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                label="Collapse all files"
                enabled={model.expanded.size > 0}
                onPress={() => {
                  model.collapseAll();
                  close();
                }}
              />
              <MenuItem
                label="Close changes"
                onPress={() => {
                  close();
                  onClose();
                }}
              />
            </>
          )}
        </AnchoredMenu>
      </View>
      {count === 0 ? (
        <View style={[styles.flex, styles.feedback]}>
          <Text style={{ color: palette.foregroundSubtle }}>
            {diff ? "No changed files." : "Loading changes…"}
          </Text>
        </View>
      ) : (
        <ScrollView
          key={`${diff?.id}:${diff?.runId}:${diff?.updatedAt}`}
          contentContainerStyle={styles.diffContent}
          style={styles.flex}
        >
          {diff?.files.map((file) => {
            const open = model.expanded.has(file.path);
            return (
              <Fragment key={file.path}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${file.path}, ${file.additions ?? 0} additions, ${file.deletions ?? 0} deletions`}
                  accessibilityState={{ expanded: open }}
                  onPress={() => model.toggle(file.path)}
                  style={[
                    styles.fileHeader,
                    {
                      width,
                      backgroundColor: palette.subtle,
                      borderBottomColor: palette.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={open ? "chevron-down" : "chevron-forward"}
                    size={16}
                    color={palette.foregroundSubtle}
                  />
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="middle"
                    style={[styles.path, { color: palette.foreground }]}
                  >
                    {file.path}
                  </Text>
                  <Text style={[styles.stat, { color: palette.success }]}>
                    +{file.additions ?? 0}
                  </Text>
                  <Text style={[styles.stat, { color: palette.danger }]}>
                    −{file.deletions ?? 0}
                  </Text>
                </Pressable>
                {open ? (
                  <View style={{ width }}>
                    <FileBody
                      file={file}
                      state={model.files[file.path]}
                      onRetry={() => void model.request(file.path, true)}
                    />
                  </View>
                ) : null}
              </Fragment>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

export const DiffSheet = memo(function DiffSheet({
  diff,
  onClose,
  onLoadFile,
  visible,
}: {
  readonly diff?: GraftDiffSummary;
  readonly onClose: () => void;
  readonly onLoadFile: (threadId: string, path: string) => Promise<GraftDiffSummary | undefined>;
  readonly visible: boolean;
}) {
  const { height } = useWindowDimensions();
  useEffect(() => {
    if (visible) Keyboard.dismiss();
  }, [visible]);
  return (
    <BottomSheet maxHeightRatio={0.92} onClose={onClose} title="Changes" visible={visible}>
      <View style={[styles.sheetBody, { height: Math.round(height * 0.82) }]}>
        <MenuProvider>
          <DiffContent diff={diff} onLoadFile={onLoadFile} onClose={onClose} />
        </MenuProvider>
      </View>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheetBody: { minHeight: 360 },
  diffContent: { paddingBottom: 24 },
  header: {
    height: 64,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSpacer: { width: 44 },
  title: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "600" },
  menuButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  fileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  path: { flex: 1, fontSize: 13, fontWeight: "600" },
  stat: { fontSize: 12, fontVariant: ["tabular-nums"] },
  feedback: {
    minHeight: 100,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  feedbackText: { textAlign: "center", fontSize: 13 },
  retry: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: graftRadius.medium },
  gap: { margin: 8, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7 },
  gapText: { fontSize: 13 },
  codeRow: { flexDirection: "row", minHeight: 22, alignItems: "flex-start" },
  code: { fontFamily: "monospace", fontSize: 13, lineHeight: 22, paddingRight: 20 },
  lineNumber: {
    width: 40,
    textAlign: "right",
    paddingRight: 7,
    borderLeftWidth: 2,
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 22,
  },
  lineSign: { width: 16, fontFamily: "monospace", fontSize: 12, lineHeight: 22 },
  previousPath: { fontSize: 12, padding: 12 },
  more: { margin: 8, padding: 12, borderRadius: graftRadius.medium, alignItems: "center" },
});
