import { describe, expect, it } from "vitest";
import { markdownBlocks } from "./markdownBlocks";

describe("streaming markdown blocks", () => {
  it("renders unfinished fenced output in the same code card as the final output", () => {
    const open = "Here is the fix:\n\n```ts\n  const result = 42;";
    expect(markdownBlocks(open)).toEqual(markdownBlocks(`${open}\n\`\`\``));
    expect(markdownBlocks(open).at(-1)).toEqual({ kind: "code", language: "ts", value: "  const result = 42;" });
  });
  it("does not close a longer fence on a shorter fence inside code", () => {
    expect(markdownBlocks("````md\n```ts\nvalue\n```\n````")).toEqual([
      { kind: "code", language: "md", value: "```ts\nvalue\n```" },
    ]);
  });
  it("preserves prose and tilde fences after a code block", () => {
    expect(markdownBlocks("~~~\ncode\n~~~\nafter")).toEqual([
      { kind: "code", language: undefined, value: "code" },
      { kind: "text", value: "after" },
    ]);
  });
});
