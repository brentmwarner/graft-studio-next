import "../index.css";

import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";

import { showContextMenuFallback } from "../contextMenuFallback";
import { getCentralIconUrl } from "./central-icons";
import { THREAD_CONTEXT_MENU_ICONS } from "./contextMenuIcons";
import { withNativeMenuIcons } from "./nativeMenuIcons";
import roundIconNames from "./central-icons-round.json";
import appIcons from "./central-icons-app.json";

const threadMenuItems = Object.entries(THREAD_CONTEXT_MENU_ICONS).map(([id, icon]) => ({
  id,
  label: id,
  icon,
}));

describe("Central context menu icons", () => {
  it("renders every app glyph, legacy glyph, and thread action as a visible Retina icon", async () => {
    const items = await withNativeMenuIcons([
      ...threadMenuItems,
      ...Object.keys(appIcons).map((name) => ({ id: name, label: name, icon: name })),
      ...roundIconNames.map((name) => ({ id: name, label: name, icon: name })),
    ]);
    for (const item of items) {
      expect(item.iconDataUrl, item.id).toMatch(/^data:image\/png;base64,/);
      const image = new Image();
      image.src = item.iconDataUrl!;
      await image.decode();
      expect([image.naturalWidth, image.naturalHeight], item.id).toEqual([32, 32]);

      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, 32, 32).data;
      expect(
        pixels.some((value, index) => index % 4 === 3 && value > 0),
        `${item.id} should contain visible pixels`,
      ).toBe(true);
    }
  });

  it("uses the same Central archive and delete glyphs in browser menus", async () => {
    const selection = showContextMenuFallback(threadMenuItems, { x: 16, y: 16 });
    try {
      for (const id of ["archive", "delete"] as const) {
        const button = page.getByRole("button", { name: id, exact: true });
        await expect.element(button).toBeVisible();
        const icon = button.element().querySelector<HTMLElement>('[data-slot="central-icon"]');
        expect(icon, id).not.toBeNull();
        expect(icon!.style.maskImage, id).toContain(
          getCentralIconUrl(THREAD_CONTEXT_MENU_ICONS[id]),
        );
        expect(icon!.getBoundingClientRect().width, id).toBe(16);
      }
    } finally {
      await userEvent.keyboard("{Escape}");
      await expect(selection).resolves.toBeNull();
    }
  });
});
