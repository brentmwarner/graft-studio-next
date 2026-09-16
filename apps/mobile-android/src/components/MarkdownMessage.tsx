import { Fragment, memo, useMemo } from "react";
import type { ReactNode } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";

import { graftRadius, useGraftPalette } from "../theme/tokens";
import { markdownBlocks } from "./markdownBlocks";

interface MarkdownMessageProps {
  readonly children: string;
}

interface MarkdownTable {
  readonly endIndex: number;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

function tableCells(line: string): readonly string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function tableAt(lines: readonly string[], startIndex: number): MarkdownTable | undefined {
  const header = lines[startIndex];
  const separator = lines[startIndex + 1];
  if (!header?.includes("|") || !separator?.includes("|")) return undefined;
  const headers = tableCells(header);
  const separatorCells = tableCells(separator);
  if (
    headers.length < 2 ||
    separatorCells.length !== headers.length ||
    !separatorCells.every((cell) => /^:?-{3,}:?$/.test(cell.replaceAll(" ", "")))
  ) {
    return undefined;
  }

  const rows: (readonly string[])[] = [];
  let endIndex = startIndex + 1;
  for (let index = startIndex + 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line?.trim() || !line.includes("|")) break;
    const cells = tableCells(line);
    rows.push(headers.map((_, cellIndex) => cells[cellIndex] ?? ""));
    endIndex = index;
  }
  return { endIndex, headers, rows };
}

function inlineNodes(text: string, accent: string, codeBackground: string): readonly ReactNode[] {
  const expression =
    /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\)|https?:\/\/[^\s<>`]*[^\s<>`.,!?;:)\]])/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of text.matchAll(expression)) {
    const index = match.index ?? cursor;
    if (index > cursor) nodes.push(text.slice(cursor, index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <Text key={key++} style={styles.bold}>
          {token.slice(2, -2)}
        </Text>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <Text key={key++} style={[styles.inlineCode, { backgroundColor: codeBackground }]}>
          {token.slice(1, -1)}
        </Text>,
      );
    } else {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(token);
      nodes.push(
        <Text
          key={key++}
          onPress={() => {
            void Linking.openURL(link?.[2] ?? token).catch(() => undefined);
          }}
          style={{ color: accent }}
        >
          {link ? inlineNodes(link[1] ?? token, accent, codeBackground) : token}
        </Text>,
      );
    }
    cursor = index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/// Memoized: the transcript re-renders its streaming tail on every token, and
/// re-parsing every settled message's Markdown each time is what made long
/// threads unusable.
export const MarkdownMessage = memo(function MarkdownMessage({ children }: MarkdownMessageProps) {
  const palette = useGraftPalette();
  const blocks = useMemo(() => markdownBlocks(children), [children]);

  return (
    <View style={styles.root}>
      {blocks.map((block, blockIndex) => {
        if (block.kind === "code") {
          return (
            <View
              key={`code-${blockIndex}`}
              style={[styles.codeBlock, { backgroundColor: palette.code }]}
            >
              {block.language ? (
                <Text style={[styles.codeLanguage, { color: palette.foregroundSubtle }]}>
                  {block.language}
                </Text>
              ) : null}
              <Text selectable style={[styles.codeText, { color: palette.foregroundMuted }]}>
                {block.value}
              </Text>
            </View>
          );
        }

        const lines = block.value.split("\n");
        return (
          <Fragment key={`text-${blockIndex}`}>
            {(() => {
              const rendered: ReactNode[] = [];
              for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
                const line = lines[lineIndex] ?? "";
                const table = tableAt(lines, lineIndex);
                if (table) {
                  rendered.push(
                    <ScrollView key={`table-${lineIndex}`} horizontal>
                      <View style={styles.table}>
                        <View style={[styles.tableRow, { backgroundColor: palette.subtle }]}>
                          {table.headers.map((cell, cellIndex) => (
                            <Text
                              key={`header-${cellIndex}`}
                              selectable
                              style={[
                                styles.tableCell,
                                styles.tableHeader,
                                {
                                  borderLeftColor: palette.border,
                                  color: palette.foreground,
                                },
                                cellIndex === 0 ? styles.firstTableCell : null,
                              ]}
                            >
                              {inlineNodes(cell, palette.link, palette.code)}
                            </Text>
                          ))}
                        </View>
                        {table.rows.map((row, rowIndex) => (
                          <View
                            key={`row-${rowIndex}`}
                            style={[
                              styles.tableRow,
                              styles.tableBodyRow,
                              { borderTopColor: palette.border },
                            ]}
                          >
                            {row.map((cell, cellIndex) => (
                              <Text
                                key={`cell-${cellIndex}`}
                                selectable
                                style={[
                                  styles.tableCell,
                                  {
                                    borderLeftColor: palette.border,
                                    color: palette.foreground,
                                  },
                                  cellIndex === 0 ? styles.firstTableCell : null,
                                ]}
                              >
                                {inlineNodes(cell, palette.link, palette.code)}
                              </Text>
                            ))}
                          </View>
                        ))}
                      </View>
                    </ScrollView>,
                  );
                  lineIndex = table.endIndex;
                  continue;
                }

                const heading = /^(#{1,3})\s+(.+)$/.exec(line);
                const bullet = /^(\s*)[-*+]\s+(.+)$/.exec(line);
                const ordered = /^(\s*)(\d+)[.)]\s+(.+)$/.exec(line);
                const quote = /^>\s?(.*)$/.exec(line);
                if (!line.trim()) {
                  rendered.push(<View key={lineIndex} style={styles.paragraphBreak} />);
                  continue;
                }
                if (heading) {
                  const level = heading[1]?.length ?? 1;
                  rendered.push(
                    <Text
                      key={lineIndex}
                      selectable
                      style={[
                        styles.text,
                        styles.heading,
                        {
                          color: palette.foreground,
                          fontSize: level === 1 ? 23 : level === 2 ? 20 : 18,
                        },
                      ]}
                    >
                      {inlineNodes(heading[2] ?? "", palette.link, palette.code)}
                    </Text>,
                  );
                  continue;
                }
                if (bullet || ordered) {
                  const content = bullet?.[2] ?? ordered?.[3] ?? "";
                  const task = bullet ? /^\[([ xX])\]\s+(.*)$/.exec(content) : null;
                  const indent = (bullet?.[1] ?? ordered?.[1] ?? "").length;
                  const itemKey = lineIndex;
                  let itemText = task?.[2] ?? content;
                  while (lineIndex + 1 < lines.length) {
                    const next = lines[lineIndex + 1] ?? "";
                    if (
                      !next.trim() ||
                      !/^\s+\S/.test(next) ||
                      /^\s*(?:[-*+] |\d+[.)] )/.test(next)
                    )
                      break;
                    itemText += ` ${next.trim()}`;
                    lineIndex += 1;
                  }
                  rendered.push(
                    <View
                      key={itemKey}
                      style={[
                        styles.listRow,
                        { marginLeft: Math.min(Math.floor(indent / 2), 4) * 18 },
                      ]}
                    >
                      <Text style={[styles.listMarker, { color: palette.foregroundMuted }]}>
                        {ordered ? `${ordered[2]}.` : task ? (task[1] === " " ? "☐" : "☑") : "•"}
                      </Text>
                      <Text
                        selectable
                        style={[styles.text, styles.listText, { color: palette.foreground }]}
                      >
                        {inlineNodes(itemText, palette.link, palette.code)}
                      </Text>
                    </View>,
                  );
                  continue;
                }
                if (quote) {
                  rendered.push(
                    <View
                      key={lineIndex}
                      style={[styles.quote, { borderLeftColor: palette.border }]}
                    >
                      <Text selectable style={[styles.text, { color: palette.foregroundMuted }]}>
                        {inlineNodes(quote[1] ?? "", palette.link, palette.code)}
                      </Text>
                    </View>,
                  );
                  continue;
                }
                const paragraphKey = lineIndex;
                let paragraph = line.trimEnd();
                let previousLine = line;
                while (lineIndex + 1 < lines.length) {
                  const next = lines[lineIndex + 1] ?? "";
                  if (
                    !next.trim() ||
                    /^\s*(?:#{1,6} |[-*+] |\d+[.)] |>|---$|\*\*\*$)/.test(next) ||
                    tableAt(lines, lineIndex + 1)
                  )
                    break;
                  const hardBreak = /(?: {2}|\\)$/.test(previousLine);
                  if (previousLine.endsWith("\\")) paragraph = paragraph.slice(0, -1);
                  paragraph += `${hardBreak ? "\n" : " "}${next.trim()}`;
                  previousLine = next;
                  lineIndex += 1;
                }
                rendered.push(
                  <Text
                    key={paragraphKey}
                    selectable
                    style={[styles.text, { color: palette.foreground }]}
                  >
                    {inlineNodes(paragraph, palette.link, palette.code)}
                  </Text>,
                );
              }
              return rendered;
            })()}
          </Fragment>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: 3, width: "100%" },
  text: { fontSize: 17, lineHeight: 25 },
  bold: { fontWeight: "700" },
  heading: {
    fontWeight: "700",
    letterSpacing: -0.35,
    marginBottom: 4,
    marginTop: 8,
  },
  paragraphBreak: { height: 16 },
  listRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    paddingVertical: 2,
  },
  listMarker: {
    fontSize: 17,
    lineHeight: 25,
    marginRight: 8,
    minWidth: 22,
    textAlign: "right",
  },
  listText: { flex: 1 },
  inlineCode: { borderRadius: 4, fontFamily: "monospace", fontSize: 14 },
  codeBlock: {
    borderRadius: graftRadius.small,
    marginVertical: 7,
    overflow: "hidden",
    padding: 12,
  },
  codeLanguage: { fontFamily: "monospace", fontSize: 11, marginBottom: 8 },
  codeText: { fontFamily: "monospace", fontSize: 13, lineHeight: 19 },
  quote: { borderLeftWidth: 2, marginVertical: 3, paddingLeft: 11 },
  table: {
    borderRadius: graftRadius.small,
    marginVertical: 8,
    overflow: "hidden",
  },
  tableRow: { flexDirection: "row" },
  tableBodyRow: { borderTopWidth: StyleSheet.hairlineWidth },
  tableCell: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    width: 176,
    fontSize: 15,
    lineHeight: 21,
    paddingHorizontal: 8,
    paddingVertical: 9,
  },
  firstTableCell: { borderLeftWidth: 0 },
  tableHeader: { fontWeight: "700" },
});
