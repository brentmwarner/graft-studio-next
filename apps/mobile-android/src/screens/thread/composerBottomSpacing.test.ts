import { describe, expect, it } from "vitest";

import { composerBottomPadding } from "./composerBottomSpacing";

describe("composerBottomPadding", () => {
  it("keeps the resting composer clear of the navigation inset", () => {
    expect(composerBottomPadding(24, false)).toBe(34);
  });

  it("uses a small design gap while the keyboard is visible", () => {
    expect(composerBottomPadding(24, true)).toBe(10);
  });
});
