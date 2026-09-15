export interface MenuAnchor {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** All coordinates are relative to the overlay, including the usable safe-area bounds. */
export function anchoredMenuLayout({ anchor, viewportWidth, top, bottom, contentHeight }: {
  readonly anchor: MenuAnchor;
  readonly viewportWidth: number;
  readonly top: number;
  readonly bottom: number;
  readonly contentHeight: number;
}) {
  const margin = 12;
  const gap = 8;
  const width = Math.max(0, Math.min(280, viewportWidth - margin * 2));
  const left = Math.max(margin, Math.min(
    anchor.x + anchor.width / 2 > viewportWidth / 2
      ? anchor.x + anchor.width - width
      : anchor.x,
    viewportWidth - width - margin,
  ));
  const above = Math.max(0, anchor.y - gap - top);
  const below = Math.max(0, bottom - anchor.y - anchor.height - gap);
  // Keep the side stable as asynchronously loaded content changes the menu's height.
  const opensAbove = above > below;
  const maxHeight = Math.max(0, Math.min(520, opensAbove ? above : below));
  const height = Math.min(contentHeight, maxHeight);
  const y = opensAbove ? anchor.y - gap - height : anchor.y + anchor.height + gap;
  return { left, top: Math.max(top, Math.min(y, bottom - height)), width, height, maxHeight };
}
