import { describe, expect, it } from "vitest";

import {
  advanceToWordBoundary,
  initialStreamingRevealContent,
  nextStreamingRevealLength,
} from "./streamingReveal";

describe("streaming reveal", () => {
  it("lands a reveal commit on a word boundary", () => {
    expect(advanceToWordBoundary("Hello streaming world", 8)).toBe(15);
    expect("Hello streaming world".slice(0, 15)).toBe("Hello streaming");
  });

  it("finishes a short unbroken tail instead of stalling", () => {
    expect(advanceToWordBoundary("hello", 2)).toBe(5);
  });

  it("hard-cuts a pathological token after the bounded lookahead", () => {
    const text = "x".repeat(100);
    expect(advanceToWordBoundary(text, 10)).toBe(10);
  });

  it("accelerates when a sparse provider snapshot creates a backlog", () => {
    const text = `${"word ".repeat(100)}done`;
    const quietStep = nextStreamingRevealLength(text.slice(0, 80), 0, 40);
    const backlogStep = nextStreamingRevealLength(text, 0, 40);
    expect(backlogStep).toBeGreaterThan(quietStep);
  });

  it("never advances beyond the cumulative target", () => {
    expect(nextStreamingRevealLength("Done", 3, 200)).toBe(4);
    expect(nextStreamingRevealLength("Done", 4, 200)).toBe(4);
  });

  it("starts an animatable active stream empty so its first snapshot is revealed", () => {
    expect(initialStreamingRevealContent("First provider snapshot", true, false)).toBe("");
    expect(initialStreamingRevealContent("Settled", false, false)).toBe("Settled");
    expect(initialStreamingRevealContent("Accessible", true, true)).toBe("Accessible");
    expect(initialStreamingRevealContent("x".repeat(20_001), true, false)).toHaveLength(20_001);
  });
});
