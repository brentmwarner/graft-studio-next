import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { getCentralIconUrl } from "./central-icons";

const reversedIconDir = path.join(import.meta.dirname, "../../public/central-icons-reversed");
const fillIconDir = path.join(import.meta.dirname, "../../public/central-icons-fill");

describe("getCentralIconUrl", () => {
  it("builds reversed and fill asset URLs for valid icon names", () => {
    expect(getCentralIconUrl("checkmark-1")).toBe("/central-icons-reversed/checkmark-1.svg");
    expect(getCentralIconUrl("star", "fill")).toBe("/central-icons-fill/star.svg");
    expect(getCentralIconUrl("plus-medium.svg")).toBe("/central-icons-reversed/plus-medium.svg");
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
      "settings-gear-4",
      "compose-pencil",
      "raising-hand-5-finger",
      "archive",
      "checkmark-1",
      "cross-medium",
      "plus-medium",
      "tasks",
    ];
    for (const name of names) {
      expect(getCentralIconUrl(name)).toBe(`/central-icons-reversed/${name}.svg`);
      expect(fs.existsSync(path.join(reversedIconDir, `${name}.svg`))).toBe(true);
    }
    expect(fs.existsSync(path.join(fillIconDir, "star.svg"))).toBe(true);
  });
});
