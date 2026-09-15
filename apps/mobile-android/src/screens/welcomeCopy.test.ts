import { describe, expect, it } from "vitest";

import { welcomeFootnote, welcomePrimaryAction } from "./welcomeCopy";

describe("welcomeCopy", () => {
  it("keeps pairing quiet until the Graft account is signed in", () => {
    expect(welcomePrimaryAction(false)).toBe("continue");
    expect(welcomePrimaryAction(true)).toBe("pair");
    expect(welcomeFootnote({ isSignedIn: false }).text).toContain("Sign in");
    expect(welcomeFootnote({ isSignedIn: true }).text).toContain("pairing link");
  });

  it("surfaces auth failures before pairing copy", () => {
    const footnote = welcomeFootnote({
      authError: "Sign-in failed. Please try again.",
      isSignedIn: false,
      pairingError: "ignored",
    });
    expect(footnote).toEqual({
      text: "Sign-in failed. Please try again.",
      tone: "danger",
    });
  });
});
