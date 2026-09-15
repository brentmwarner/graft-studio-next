import { describe, expect, it } from "vitest";

import { iosPairingSurfaceAfter } from "./iosPairingFlow";

describe("iosPairingSurfaceAfter", () => {
  it("opens the live camera instead of a pairing drawer", () => {
    expect(iosPairingSurfaceAfter("openPairing")).toBe("scan");
  });

  it("opens paste when a pairing link is already waiting", () => {
    expect(iosPairingSurfaceAfter("openPairing", true)).toBe("paste");
  });

  it("keeps paste and scan as mutually exclusive full-screen surfaces", () => {
    expect(iosPairingSurfaceAfter("pasteInstead")).toBe("paste");
    expect(iosPairingSurfaceAfter("scanInstead")).toBe("scan");
    expect(iosPairingSurfaceAfter("close")).toBe("welcome");
  });
});
