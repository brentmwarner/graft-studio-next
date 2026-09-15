import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StreamingMarkdownMessage } from "./StreamingMarkdownMessage";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => motion.reduced }));
vi.mock("../../components/MarkdownMessage", () => ({ MarkdownMessage: "Markdown" }));

let renderer: ReactTestRenderer | undefined;
const frame = (content: string, streaming = true) =>
  createElement(StreamingMarkdownMessage, { content, streaming });
const visible = () => renderer!.root.find((node) => node.type === "Markdown").props.children;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  motion.reduced = false;
});
afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("streaming text delivery", () => {
  it("preserves received text immediately when mounting or remounting", async () => {
    await act(() => {
      renderer = create(frame("Already received"));
    });
    expect(visible()).toBe("Already received");
    await act(() => renderer!.unmount());
    await act(() => {
      renderer = create(frame("Already received and continued"));
    });
    expect(visible()).toBe("Already received and continued");
  });

  it("renders a large received batch in full within 32ms", async () => {
    await act(() => {
      renderer = create(frame("Start"));
    });
    const target = `Start ${"received text 😀 ".repeat(500)}`;
    await act(() => renderer!.update(frame(target)));
    await act(() => vi.advanceTimersByTime(32));
    expect(visible()).toBe(target);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not postpone the commit when more tokens arrive", async () => {
    await act(() => {
      renderer = create(frame("A"));
    });
    await act(() => renderer!.update(frame("A B")));
    await act(() => vi.advanceTimersByTime(16));
    await act(() => renderer!.update(frame("A B C")));
    expect(visible()).toBe("A");
    await act(() => vi.advanceTimersByTime(16));
    expect(visible()).toBe("A B C");
  });

  it("flushes the final response immediately and cancels pending work", async () => {
    await act(() => {
      renderer = create(frame("A"));
    });
    await act(() => renderer!.update(frame("A B")));
    await act(() => renderer!.update(frame("A B C", false)));
    expect(visible()).toBe("A B C");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("replaces corrected text immediately without replaying the old tail", async () => {
    await act(() => {
      renderer = create(frame("Original"));
    });
    await act(() => renderer!.update(frame("Original pending")));
    await act(() => renderer!.update(frame("Corrected")));
    expect(visible()).toBe("Corrected");
    await act(() => vi.advanceTimersByTime(32));
    expect(visible()).toBe("Corrected");
  });

  it("shows all received text immediately with reduced motion", async () => {
    motion.reduced = true;
    await act(() => {
      renderer = create(frame("A"));
    });
    await act(() => renderer!.update(frame("A B C")));
    expect(visible()).toBe("A B C");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the pending commit when the row unmounts", async () => {
    await act(() => {
      renderer = create(frame("A"));
    });
    await act(() => renderer!.update(frame("A B")));
    await act(() => renderer!.unmount());
    renderer = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });
});
