import { memo, useLayoutEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import Animated from "react-native-reanimated";

import { useGraftPalette } from "../theme/tokens";

const FADE_MS = 180;
interface RevealState {
  readonly text: string;
  readonly base: string;
  readonly spans: readonly { offset: number; text: string; at: number }[];
}

export function appendReveal(
  previous: RevealState,
  text: string,
  animate: boolean,
  now: number,
): RevealState {
  if (text === previous.text && (animate || previous.spans.length === 0)) return previous;
  if (!animate || !text.startsWith(previous.text)) return { text, base: text, spans: [] };
  const spans = previous.spans.filter((span) => now - span.at < FADE_MS).slice(-7);
  spans.push({ offset: previous.text.length, text: text.slice(previous.text.length), at: now });
  return { text, base: text.slice(0, spans[0]?.offset ?? text.length), spans };
}

/** UI-thread color fades only the new suffix; old text never blinks or queues up. */
export const StreamingText = memo(function StreamingText({
  text,
  animate,
}: {
  readonly text: string;
  readonly animate: boolean;
}) {
  const palette = useGraftPalette();
  const fadeStyle = useMemo(
    () => ({
      color: palette.foreground,
      animationName: {
        from: { color: palette.foregroundSubtle },
        to: { color: palette.foreground },
      },
      animationDuration: FADE_MS,
      animationTimingFunction: "ease-out" as const,
    }),
    [palette.foreground, palette.foregroundSubtle],
  );
  const [state, setState] = useState<RevealState>(() => ({ text, base: text, spans: [] }));
  const next = useMemo(
    () => appendReveal(state, text, animate, Date.now()),
    [state, text, animate],
  );
  useLayoutEffect(() => {
    if (next !== state) setState(next);
  }, [next, state]);
  // Render received text immediately; only committed renders advance the reveal snapshot.
  // History, remounts, corrections and completion show immediately.
  if (!animate || next.spans.length === 0) return text;
  return (
    <Text>
      {next.base}
      {next.spans.map((span) => (
        <Animated.Text key={span.offset} style={fadeStyle}>
          {span.text}
        </Animated.Text>
      ))}
    </Text>
  );
});
