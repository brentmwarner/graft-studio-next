import { describe, expect, it } from "vitest";

import { iosPairingSurfaceAfter } from "./iosPairingFlow";

describe("iOS pairing presentation", () => {
  it("uses mutually exclusive scanner and paste surfaces", () => {
    expect(iosPairingSurfaceAfter("openPairing")).toBe("scan");
    expect(iosPairingSurfaceAfter("openPairing", true)).toBe("paste");
    expect(iosPairingSurfaceAfter("pasteInstead")).toBe("paste");
    expect(iosPairingSurfaceAfter("scanInstead")).toBe("scan");
    expect(iosPairingSurfaceAfter("close")).toBe("welcome");
  });
});
