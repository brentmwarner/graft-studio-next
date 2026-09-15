import { THINKING_PHRASE, toolRunningPhrase } from "./toolPresentation";
import type { TranscriptItem } from "./mobileViewModels";

export function livePhraseFromItems(items: readonly TranscriptItem[]): string {
  const lastUser = items.findLastIndex((item) => item.kind === "user");
  for (let index = items.length - 1; index > lastUser; index -= 1) {
    const item = items[index];
    if (item?.kind === "assistant") return THINKING_PHRASE;
    if (item?.kind === "tool" && item.running) {
      return toolRunningPhrase(item.name, item.detail);
    }
    if (item?.kind === "toolGroup") {
      const running = item.tools.findLast((tool) => tool.running);
      if (running) return toolRunningPhrase(running.name, running.detail);
    }
  }
  return THINKING_PHRASE;
}

export interface TranscriptLiveStatus {
  readonly phrase: string;
  readonly animating: boolean;
}

export function transcriptLiveStatus({
  items,
  isWorking,
  isConnected,
  needsInput,
}: {
  readonly items: readonly TranscriptItem[];
  readonly isWorking: boolean;
  readonly isConnected: boolean;
  readonly needsInput: boolean;
}): TranscriptLiveStatus | null {
  if (!isWorking) return null;
  if (!isConnected) return { phrase: "Reconnecting…", animating: false };
  if (needsInput) return { phrase: "Waiting for you", animating: false };
  const tail = items.at(-1);
  // The answer is its own progress indicator. Do not put "Thinking" below
  // visible output, including the gap before a terminal snapshot arrives.
  if (tail?.kind === "assistant" && tail.text.trim()) return null;
  return { phrase: livePhraseFromItems(items), animating: true };
}
