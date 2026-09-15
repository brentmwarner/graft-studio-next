import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";

import type { TranscriptItem } from "../../state/mobileViewModels";
import { nextFollowLatch, transcriptFollowContent } from "../../state/transcriptFollow";

export function useTranscriptFollow(
  threadId: string,
  items: readonly TranscriptItem[],
  canStream: boolean,
) {
  const listRef = useRef<FlatList<TranscriptItem>>(null);
  const contentHeightRef = useRef(0);
  const isAwayRef = useRef(false);
  const isDraggingRef = useRef(false);
  const pendingContentRef = useRef(true);
  const streamingRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const [isAwayFromBottom, setIsAwayFromBottom] = useState(false);
  const content = transcriptFollowContent(items);

  const setAway = useCallback((away: boolean) => {
    if (isAwayRef.current === away) return;
    isAwayRef.current = away;
    setIsAwayFromBottom(away);
  }, []);

  const scrollToBottom = useCallback((animated: boolean) => {
    // Native clamps to its current maximum. VirtualizedList's cached end can
    // still refer to the previous text measurement during this callback.
    listRef.current?.scrollToOffset({ offset: contentHeightRef.current, animated });
  }, []);

  const cancelFollowFrame = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const scheduleFollow = useCallback(
    (animated: boolean) => {
      cancelFollowFrame();
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        if (!isAwayRef.current && !isDraggingRef.current) scrollToBottom(animated);
      });
    },
    [cancelFollowFrame, scrollToBottom],
  );

  useLayoutEffect(() => {
    cancelFollowFrame();
    contentHeightRef.current = 0;
    isDraggingRef.current = false;
    pendingContentRef.current = true;
    setAway(false);
  }, [cancelFollowFrame, setAway, threadId]);

  useLayoutEffect(() => {
    streamingRef.current = canStream && content.streaming;
  }, [canStream, content.streaming]);

  // Only real message changes request follow. Tool rows, reasoning, status,
  // snapshot refreshes and reconnects cannot re-arm the user's scroll latch.
  useLayoutEffect(() => {
    pendingContentRef.current = true;
    scheduleFollow(false);
  }, [content.messageCount, content.lastMessageId, content.lastMessageText, scheduleFollow]);

  useEffect(() => cancelFollowFrame, [cancelFollowFrame]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      contentHeightRef.current = contentSize.height;
      setAway(
        nextFollowLatch({
          distanceFromBottom: contentSize.height - contentOffset.y - layoutMeasurement.height,
          isAway: isAwayRef.current,
          isUserDragging: isDraggingRef.current,
        }),
      );
    },
    [setAway],
  );

  const handleScrollBeginDrag = useCallback(() => {
    cancelFollowFrame();
    isDraggingRef.current = true;
    pendingContentRef.current = false;
  }, [cancelFollowFrame]);

  const handleScrollSettled = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const handleScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      handleScroll(event);
      // A fling is still user scrolling. MomentumScrollEnd releases this guard.
      if (!event.nativeEvent.velocity?.y) isDraggingRef.current = false;
    },
    [handleScroll],
  );

  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeightRef.current = height;
      const shouldFollow = pendingContentRef.current || streamingRef.current;
      pendingContentRef.current = false;
      if (shouldFollow && !isAwayRef.current && !isDraggingRef.current) scheduleFollow(false);
    },
    [scheduleFollow],
  );

  const handleListLayout = useCallback(
    (_event: LayoutChangeEvent) => {
      // Keyboard/viewport changes preserve the bottom only if already following.
      pendingContentRef.current = true;
      scheduleFollow(false);
    },
    [scheduleFollow],
  );

  const jumpToLatest = useCallback(() => {
    isDraggingRef.current = false;
    setAway(false);
    pendingContentRef.current = true;
    scheduleFollow(true);
  }, [scheduleFollow, setAway]);

  return {
    handleContentSizeChange,
    handleListLayout,
    handleScroll,
    handleScrollBeginDrag,
    handleScrollEndDrag,
    handleScrollSettled,
    isAwayFromBottom,
    jumpToLatest,
    listRef,
    pinToBottomForSend: jumpToLatest,
  };
}
