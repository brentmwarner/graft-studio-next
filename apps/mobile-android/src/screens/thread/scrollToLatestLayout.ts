export const SCROLL_TO_LATEST_SIZE = 42;

export interface ComposerAccessoryLayout {
  readonly y: number;
  readonly height: number;
}

/** Position the overlay without adding to the composer's measured height. */
export function scrollToLatestBottom(
  chromeHeight: number,
  diffRow?: ComposerAccessoryLayout,
): number {
  if (diffRow) {
    return chromeHeight - diffRow.y - diffRow.height / 2 - SCROLL_TO_LATEST_SIZE / 2;
  }
  // No diff row to share: clear the composer and any task/interaction controls.
  return chromeHeight + 10;
}
