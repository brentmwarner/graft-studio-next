import { memo, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";

import { MarkdownMessage } from "../../components/MarkdownMessage";
import { STREAM_REVEAL_COMMIT_MS } from "./streamingReveal";

interface StreamingMarkdownMessageProps {
  readonly content: string;
  readonly streaming: boolean;
}

// Parse Markdown at most once per batch, displaying everything received by
// that point. New tokens cannot postpone the pending commit or form a backlog.
export const StreamingMarkdownMessage = memo(function StreamingMarkdownMessage({
  content,
  streaming,
}: StreamingMarkdownMessageProps) {
  const reduceMotion = useReducedMotion();
  const [displayedContent, setDisplayedContent] = useState(content);
  const targetRef = useRef(content);
  const displayedRef = useRef(content);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showImmediately = !streaming || reduceMotion || !content.startsWith(displayedContent);

  useEffect(() => {
    targetRef.current = content;
    if (showImmediately) {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      displayedRef.current = content;
      setDisplayedContent(content);
      return;
    }
    if (displayedRef.current !== content && timerRef.current === null) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        displayedRef.current = targetRef.current;
        setDisplayedContent(targetRef.current);
      }, STREAM_REVEAL_COMMIT_MS);
    }
  }, [content, showImmediately]);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  const visibleContent = showImmediately ? content : displayedContent;
  return visibleContent ? <MarkdownMessage>{visibleContent}</MarkdownMessage> : null;
});
