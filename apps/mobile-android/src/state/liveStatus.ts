import { THINKING_PHRASE, toolRunningPhrase } from "./toolPresentation";
import type { TranscriptItem } from "./mobileViewModels";

export function livePhraseFromItems(items: readonly TranscriptItem[]): string {
  const lastUser = items.findLastIndex((item) => item.kind === "user");
  const start = lastUser >= 0 ? lastUser + 1 : 0;
  for (let index = items.length - 1; index >= start; index -= 1) {
    const item = items[index];
    if (item?.kind === "tool" && item.running) {
      return toolRunningPhrase(item.name, item.detail);
    }
    if (item?.kind === "toolGroup") {
      const running = [...item.tools].reverse().find((tool) => tool.running);
      if (running) return toolRunningPhrase(running.name, running.detail);
    }
  }
  return THINKING_PHRASE;
}

/// Match desktop's liveness footer: the branded loader stays visible for the
/// entire active turn, including while reasoning, tools, or reply text stream.
export function shouldShowStreamingFooter(isWorking: boolean): boolean {
  return isWorking;
}
