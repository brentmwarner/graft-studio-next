import { describe, expect, it } from "vitest";

import { SCROLL_TO_LATEST_SIZE, scrollToLatestBottom } from "./scrollToLatestLayout";

describe("scroll-to-latest overlay", () => {
  it.each([36, 44, 64])("centers beside a %ipt diff pill without sizing its row", (height) => {
    const chromeHeight = 160;
    const row = { y: 20, height };
    const screenHeight = 900;
    const arrowCenter =
      screenHeight - scrollToLatestBottom(chromeHeight, row) - SCROLL_TO_LATEST_SIZE / 2;
    const pillCenter = screenHeight - chromeHeight + row.y + row.height / 2;
    expect(arrowCenter).toBe(pillCenter);
  });

  it("keeps alignment when task details grow above the diff row", () => {
    const collapsed = scrollToLatestBottom(150, { y: 54, height: 36 });
    const expanded = scrollToLatestBottom(350, { y: 254, height: 36 });
    expect(expanded).toBe(collapsed);
  });

  it("clears occupied chrome when there is no diff row", () => {
    for (const chromeHeight of [90, 144, 384]) {
      expect(scrollToLatestBottom(chromeHeight) - chromeHeight).toBe(10);
    }
  });

  it("tracks composer height and keyboard inset changes without an extra row", () => {
    const row = { y: 0, height: 36 };
    const idle = scrollToLatestBottom(136, row);
    expect(scrollToLatestBottom(112, row) - idle).toBe(-24);
    expect(scrollToLatestBottom(200, row) - idle).toBe(64);
  });
});
