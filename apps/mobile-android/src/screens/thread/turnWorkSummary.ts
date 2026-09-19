import type { TranscriptItem } from "../../state/mobileViewModels";

export function turnWorkSummary(foldedActivity: readonly TranscriptItem[]): string {
  const toolCount = foldedActivity.filter((item) => item.kind === "tool").length;
  if (toolCount === 1) return "Used 1 tool";
  if (toolCount > 1) return `Used ${toolCount} tools`;
  return "Worked";
}
