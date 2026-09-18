// Coalesce rapid provider updates without adding a separate typing speed.
// Keep this interval aligned with iOS StreamingReveal.
export const STREAM_REVEAL_COMMIT_MS = 32;

const PARTIAL_LINK = /(?<!\\)\[([^\]\n]+)\]\([^)\n]*$/;

/// Until a link destination closes, show its label without flashing a raw
/// URL into the paragraph. Keep code examples and final source untouched.
export function readableMarkdownTail(text: string): string {
  const match = PARTIAL_LINK.exec(text);
  if (!match || match.index === undefined) return text;
  const labelEnd = text.indexOf("](", match.index);
  if (labelEnd < 0) return text;
  const prefix = text.slice(0, match.index);
  let codeDelimiter: number | undefined;
  let cursor = 0;
  while (cursor < prefix.length) {
    if (prefix[cursor] === "`") {
      let end = cursor;
      while (end < prefix.length && prefix[end] === "`") end += 1;
      const length = end - cursor;
      if (codeDelimiter === length) codeDelimiter = undefined;
      else if (codeDelimiter === undefined) codeDelimiter = length;
      cursor = end;
    } else {
      cursor += 1;
    }
  }
  if (codeDelimiter !== undefined) return text;
  return prefix + text.slice(match.index + 1, labelEnd);
}
