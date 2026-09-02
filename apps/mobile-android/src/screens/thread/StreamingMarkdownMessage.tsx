import { memo, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";

import { MarkdownMessage } from "../../components/MarkdownMessage";
import {
  initialStreamingRevealContent,
  nextStreamingRevealLength,
  STREAM_REVEAL_COMMIT_MS,
  STREAM_REVEAL_MAX_CHARS,
} from "./streamingReveal";

interface StreamingMarkdownMessageProps {
  readonly content: string;
  readonly streaming: boolean;
}

/**
 * Smooth cumulative gateway snapshots into the same word-paced stream used by
 * Graft desktop. The Markdown parser sees at most one update per reveal
 * cadence, and completion always flushes the exact host text immediately.
 */
export const StreamingMarkdownMessage = memo(function StreamingMarkdownMessage({
  content,
  streaming,
}: StreamingMarkdownMessageProps) {
  const reduceMotion = useReducedMotion();
  const [displayedContent, setDisplayedContent] = useState(() =>
    initialStreamingRevealContent(content, streaming, reduceMotion),
  );
  const targetRef = useRef(content);
  const displayedRef = useRef(displayedContent);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommitRef = useRef<number | null>(null);
  const tickRef = useRef<() => void>(() => undefined);

  targetRef.current = content;

  tickRef.current = () => {
    timerRef.current = null;
    const target = targetRef.current;
    const current = displayedRef.current;
    if (current.length >= target.length) {
      lastCommitRef.current = null;
      return;
    }

    const now = Date.now();
    const elapsed =
      lastCommitRef.current === null
        ? STREAM_REVEAL_COMMIT_MS
        : now - lastCommitRef.current;
    lastCommitRef.current = now;
    const nextLength = nextStreamingRevealLength(
      target,
      current.length,
      elapsed,
    );
    const next = target.slice(0, nextLength);
    displayedRef.current = next;
    setDisplayedContent(next);

    if (nextLength < target.length) {
      timerRef.current = setTimeout(
        () => tickRef.current(),
        STREAM_REVEAL_COMMIT_MS,
      );
    }
  };

  useEffect(() => {
    const current = displayedRef.current;
    const shouldFlush =
      !streaming ||
      reduceMotion ||
      content.length > STREAM_REVEAL_MAX_CHARS ||
      !content.startsWith(current);

    if (shouldFlush) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      lastCommitRef.current = null;
      if (current !== content) {
        displayedRef.current = content;
        setDisplayedContent(content);
      }
      return;
    }

    if (current.length < content.length && timerRef.current === null) {
      timerRef.current = setTimeout(
        () => tickRef.current(),
        STREAM_REVEAL_COMMIT_MS,
      );
    }
  }, [content, reduceMotion, streaming]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  return displayedContent ? (
    <MarkdownMessage>{displayedContent}</MarkdownMessage>
  ) : null;
});
