import { describe, expect, it } from "vitest";

import { anchoredMenuLayout } from "./anchoredMenuLayout";

describe("anchored menu placement", () => {
  it("opens the header menu beneath its trigger and aligns to the right", () => {
    expect(anchoredMenuLayout({
      anchor: { x: 310, y: 48, width: 44, height: 44 },
      viewportWidth: 390, top: 32, bottom: 800, contentHeight: 300,
    })).toMatchObject({ left: 74, top: 100, width: 280, height: 300 });
  });
  it("keeps composer menus above the trigger as their content grows", () => {
    const input = { anchor: { x: 16, y: 670, width: 160, height: 32 }, viewportWidth: 390, top: 32, bottom: 800 };
    const initial = anchoredMenuLayout({ ...input, contentHeight: 160 });
    const expanded = anchoredMenuLayout({ ...input, contentHeight: 350 });
    expect(initial.top + initial.height).toBe(662);
    expect(expanded.top + expanded.height).toBe(662);
  });
  it("caps long menus above the keyboard and leaves scrolling space", () => {
    const layout = anchoredMenuLayout({
      anchor: { x: 16, y: 340, width: 160, height: 32 },
      viewportWidth: 390, top: 32, bottom: 430, contentHeight: 900,
    });
    expect(layout.top).toBe(32);
    expect(layout.height).toBe(300);
    expect(layout.top + layout.height).toBeLessThan(340);
  });
  it("fits narrow displays without crossing the screen edge", () => {
    const layout = anchoredMenuLayout({
      anchor: { x: 216, y: 48, width: 44, height: 44 },
      viewportWidth: 272, top: 32, bottom: 600, contentHeight: 250,
    });
    expect(layout.width).toBe(248);
    expect(layout.left).toBe(12);
    expect(layout.left + layout.width).toBe(260);
  });
});
