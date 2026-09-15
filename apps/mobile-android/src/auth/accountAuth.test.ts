import { describe, expect, it } from "vitest";

import {
  ACCOUNT_CONTROL_PLANE_URL,
  ACCOUNT_FLOW_VERSION,
  accountMonogram,
  base64URLFromBase64,
  isAccountAuthCallback,
  loginURL,
  parseAuthCallback,
} from "./accountAuth";

describe("accountAuth", () => {
  it("builds the WorkOS mobile login URL", () => {
    expect(loginURL("state-token", "challenge-token")).toBe(
      `${ACCOUNT_CONTROL_PLANE_URL}/auth/mobile/login?state=state-token&code_challenge=challenge-token&flow_version=${ACCOUNT_FLOW_VERSION}`,
    );
  });

  it("parses a graft:// grant callback and ignores pairing links", () => {
    expect(parseAuthCallback("graft://auth?grant=one-time&state=abc")).toEqual({
      grant: "one-time",
      state: "abc",
    });
    expect(isAccountAuthCallback("graft://pair?v=1&host=http://10.0.0.2")).toBe(false);
    expect(parseAuthCallback("not a url")).toBeNull();
  });

  it("encodes PKCE material as base64url", () => {
    expect(base64URLFromBase64("ab+c/de==")).toBe("ab-c_de");
  });

  it("uses the first letter of the account name, then email", () => {
    expect(accountMonogram("Brent Warner", "brent@graft.app")).toBe("B");
    expect(accountMonogram(undefined, "brent@graft.app")).toBe("B");
    expect(accountMonogram(undefined, undefined)).toBe("•");
  });
});
