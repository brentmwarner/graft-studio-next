import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";

import type { TranscriptItem } from "../../state/mobileViewModels";
import { nextFollowLatch } from "../../state/transcriptFollow";

export function useTranscriptFollow(activeRunId: string | undefined) {
  const listRef = useRef<FlatList<TranscriptItem>>(null);
  // The two numbers `scrollToBottom` needs, kept off state so a follow-scroll
  // never waits on a render.
  const contentHeightRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const [isAwayFromBottom, setIsAwayFromBottom] = useState(false);
  const isAwayFromBottomRef = useRef(false);
  const isUserDraggingRef = useRef(false);

  // Mirrored into a ref so the scroll handlers can read the latch without
  // taking it as a dependency — otherwise every frame hands `FlatList` a new
  // callback identity.
  const setAwayFromBottom = useCallback((away: boolean) => {
    if (isAwayFromBottomRef.current === away) return;
    isAwayFromBottomRef.current = away;
    setIsAwayFromBottom(away);
  }, []);

  /// Scroll to the true end of the transcript.
  ///
  /// Deliberately NOT `scrollToEnd()`. That helper targets
  /// `contentLength - visibleLength` off `VirtualizedList`'s own scroll
  /// metrics, and those metrics are still the PREVIOUS content height while
  /// our `onContentSizeChange` is running — so every follow-scroll landed one
  /// growth-step short. Measured: content 46029, scrollToEnd stopped at 44017,
  /// i.e. 1097pt of transcript left stranded under the composer. Streaming
  /// grows the content continuously, so the list never caught up and the tail
  /// stayed hidden. Tracking the height RN hands us and scrolling to an offset
  /// we compute ourselves sidesteps the stale read entirely.
  const scrollToBottom = useCallback((animated: boolean) => {
    // Deliberately one viewport PAST the computed end. The exact target would
    // be `contentHeight - viewport`, but the native scroll range trails the
    // content height JS reports while rows are still being measured — during
    // streaming that left us ~90pt short every time, which is exactly the band
    // the composer covers. Asking for more than the maximum lets the native
    // scroller clamp to its own true bottom, whatever it currently is.
    listRef.current?.scrollToOffset({
      animated,
      offset: contentHeightRef.current,
    });
  }, []);

  // A turn becoming active without a send — resuming a live run after a
  // reconnect — must not inherit a stale latch from before the drop.
  useEffect(() => {
    if (!activeRunId) return;
    isUserDraggingRef.current = false;
    setAwayFromBottom(false);
  }, [activeRunId, setAwayFromBottom]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      // Freshest measurements we get — keep the scroll refs honest even if a
      // content-size or layout callback was coalesced away.
      contentHeightRef.current = contentSize.height;
      viewportHeightRef.current = layoutMeasurement.height;
      setAwayFromBottom(
        nextFollowLatch({
          distanceFromBottom:
            contentSize.height - (contentOffset.y + layoutMeasurement.height),
          isAway: isAwayFromBottomRef.current,
          isUserDragging: isUserDraggingRef.current,
        }),
      );
    },
    [setAwayFromBottom],
  );

  // Only finger-driven scrolling may arm the latch. Without this gate the app's
  // own follow-scroll armed it — the transcript grows a frame before the scroll
  // lands, which looks exactly like the user pulling away — and the transcript
  // then stopped following the stream for the rest of the session.
  const handleScrollBeginDrag = useCallback(() => {
    isUserDraggingRef.current = true;
  }, []);

  const handleScrollSettled = useCallback(() => {
    isUserDraggingRef.current = false;
  }, []);

  const jumpToLatest = useCallback(() => {
    isUserDraggingRef.current = false;
    setAwayFromBottom(false);
    scrollToBottom(true);
  }, [scrollToBottom, setAwayFromBottom]);

  // `h` is the authoritative new content height, and it is the whole reason
  // this doesn't call `scrollToEnd`. See `scrollToBottom`.
  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeightRef.current = height;
      if (!isAwayFromBottomRef.current) scrollToBottom(false);
    },
    [scrollToBottom],
  );

  function handleListLayout(event: LayoutChangeEvent) {
    viewportHeightRef.current = event.nativeEvent.layout.height;
  }

  const pinToBottomForSend = useCallback(() => {
    // The user's own send re-pins: clear the latch as well as scrolling, or the
    // new turn streams in off-screen behind a stuck jump button.
    isUserDraggingRef.current = false;
    setAwayFromBottom(false);
    requestAnimationFrame(() => scrollToBottom(true));
  }, [scrollToBottom, setAwayFromBottom]);

  return {
    handleContentSizeChange,
    handleListLayout,
    handleScroll,
    handleScrollBeginDrag,
    handleScrollSettled,
    isAwayFromBottom,
    jumpToLatest,
    listRef,
    pinToBottomForSend,
  };
}
