import { describe, expect, it } from "vitest";

import { PAIRING_FOOTNOTE } from "./welcomeCopy";

describe("welcome copy", () => {
  it("asks the user to pair after opening Studio", () => {
    expect(PAIRING_FOOTNOTE).toContain("Open Graft Studio on this computer");
    expect(PAIRING_FOOTNOTE).toContain("scan or paste the pairing link");
  });
});
