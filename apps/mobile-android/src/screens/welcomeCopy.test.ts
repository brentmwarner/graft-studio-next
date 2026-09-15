import { describe, expect, it } from "vitest";

import { welcomeFootnote, welcomePrimaryAction } from "./welcomeCopy";

describe("native welcome copy", () => {
  it("switches from account sign-in to Studio pairing", () => {
    expect(welcomePrimaryAction(false)).toBe("continue");
    expect(welcomePrimaryAction(true)).toBe("pair");
    expect(welcomeFootnote({ isSignedIn: false }).text).toContain("Sign in");
    expect(welcomeFootnote({ isSignedIn: true }).text).toContain("pairing link");
  });

  it("prioritizes actionable authentication failures", () => {
    expect(
      welcomeFootnote({
        authError: "Sign-in failed. Please try again.",
        isSignedIn: false,
        pairingError: "ignored",
      }),
    ).toEqual({ text: "Sign-in failed. Please try again.", tone: "danger" });
  });
});
