import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CentralIcon, getCentralIconUrl } from "./central-icons";
import * as icons from "./icons";
import roundIconNames from "./central-icons-round.json";
import appIcons from "./central-icons-app.json";

const roundIconDir = path.join(import.meta.dirname, "../../public/central-icons-round");
const fillIconDir = path.join(import.meta.dirname, "../../public/central-icons-fill");

describe("getCentralIconUrl", () => {
  it("uses app glyphs with Central fallbacks and preserves explicit variants", () => {
    expect(getCentralIconUrl("checkmark-1")).toBe("/central-icons-app/checkmark-1.svg");
    expect(getCentralIconUrl("star", "fill")).toBe("/central-icons-fill/star.svg");
    expect(getCentralIconUrl("plus-medium.svg")).toBe("/central-icons-app/plus-medium.svg");
    expect(getCentralIconUrl("checkmark-1", "round")).toBe("/central-icons-round/checkmark-1.svg");
    expect(getCentralIconUrl("checkmark-1", "reversed")).toBe(
      "/central-icons-reversed/checkmark-1.svg",
    );
    expect(getCentralIconUrl("tasks")).toBe("/central-icons-round/tasks.svg");
    expect(getCentralIconUrl("shield-access")).toBe("/central-icons-reversed/shield-access.svg");
  });

  it("rejects path traversal and invalid names", () => {
    expect(getCentralIconUrl("../etc/passwd")).toBeNull();
    expect(getCentralIconUrl("CHECK")).toBeNull();
    expect(getCentralIconUrl("icon name")).toBeNull();
    expect(getCentralIconUrl("")).toBeNull();
  });

  it("ships the chrome glyphs used by sidebar, settings, and composer", () => {
    const names = [
      "branch",
      "settings-gear-1",
      "edit-big",
      "raising-hand-5-finger",
      "archive",
      "checkmark-1",
      "cross-medium",
      "plus-medium",
      "tasks",
    ];
    for (const name of names) {
      expect(fs.existsSync(path.join(roundIconDir, `${name}.svg`))).toBe(true);
    }
    expect(fs.existsSync(path.join(fillIconDir, "star.svg"))).toBe(true);
  });

  it("ships every generated rounded asset", () => {
    for (const name of roundIconNames) {
      expect(fs.existsSync(path.join(roundIconDir, `${name}.svg`)), name).toBe(true);
    }
  });

  it("ships every app override and retains Synara's original Skills artwork", () => {
    for (const name of Object.keys(appIcons)) {
      const asset = getCentralIconUrl(name)!;
      expect(asset).toBe(`/central-icons-app/${name}.svg`);
      expect(fs.existsSync(path.join(import.meta.dirname, "../../public", asset)), name).toBe(true);
    }
    const original = fs.readFileSync(
      path.join(import.meta.dirname, "../../public/central-icons-reversed/building-blocks.svg"),
      "utf8",
    );
    const current = fs.readFileSync(
      path.join(import.meta.dirname, "../../public", getCentralIconUrl(icons.SKILL_ICON_NAME)!),
      "utf8",
    );
    expect(current.trim()).toBe(original.trim());
  });
});

describe("CentralIcon accessibility", () => {
  it("keeps an explicit status role for a labeled loader", () => {
    const html = renderToStaticMarkup(
      createElement(CentralIcon, {
        name: "loader",
        label: "Updating app icon",
        role: "status",
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Updating app icon"');
    expect(html).not.toContain('role="img"');
  });

  it("applies chevron motion classes to the masked glyph", () => {
    const html = renderToStaticMarkup(
      createElement(CentralIcon, {
        name: "chevron-right",
        className: "duration-220 rotate-90",
        "aria-hidden": true,
      }),
    );
    expect(html).toContain("duration-220");
    expect(html).toContain("rotate-90");
    expect(html).toContain('data-slot="central-icon"');
    expect(html).toContain("aria-hidden");
  });
});

describe("Loader2Icon adapter", () => {
  it("forwards status role and accessible name to the Central glyph", () => {
    const html = renderToStaticMarkup(
      createElement(icons.Loader2Icon, {
        "aria-label": "Updating app icon",
        role: "status",
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Updating app icon"');
    expect(html).not.toContain('role="img"');
  });
});

describe("app icon registry", () => {
  it("renders every app control with a shipped Central asset", () => {
    for (const [name, Icon] of Object.entries(icons)) {
      if (typeof Icon !== "function") continue;
      const markup = renderToStaticMarkup(createElement(Icon));
      expect(markup, name).toContain('data-slot="central-icon"');
      const assetPath = markup.match(
        /\/central-icons-(?:app|round|reversed|fill)\/[a-z0-9-]+\.svg/,
      )?.[0];
      expect(assetPath, name).toBeDefined();
      expect(fs.existsSync(path.join(import.meta.dirname, "../../public", assetPath!)), name).toBe(
        true,
      );
    }
  });
});
