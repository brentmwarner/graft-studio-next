export interface MarkdownBlock {
  readonly kind: "code" | "text";
  readonly language?: string;
  readonly value: string;
}

/** Open code fences already render as code, so closing one doesn't replace
 * a tall block of prose with a differently measured code card. */
export function markdownBlocks(markdown: string): readonly MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.split("\n");
  let prose: string[] = [];
  let code: string[] | undefined;
  let fence = "";
  let language: string | undefined;
  const flushProse = () => {
    if (prose.length > 0) blocks.push({ kind: "text", value: prose.join("\n") });
    prose = [];
  };
  const flushCode = () => {
    blocks.push({ kind: "code", language, value: (code ?? []).join("\n") });
    code = undefined;
  };
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (code) {
      if (
        marker &&
        marker[1]?.[0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2]?.trim()
      ) {
        flushCode();
      } else {
        code.push(line);
      }
    } else if (marker) {
      flushProse();
      fence = marker[1] ?? "```";
      language = marker[2]?.trim() || undefined;
      code = [];
    } else {
      prose.push(line);
    }
  }
  if (code) flushCode();
  flushProse();
  return blocks;
}
