import { describe, expect, it } from "vitest";

import { isTrustedAccountSender } from "./graftAccountIpc";

describe("Graft account IPC ownership", () => {
  it("accepts only the owned main frame on its app origin", () => {
    const frame = { url: "graft://app/index.html#/settings" };
    const owner = { mainFrame: frame, isDestroyed: () => false };
    const event = { sender: owner, senderFrame: frame };
    expect(isTrustedAccountSender(event, owner, "graft://app/index.html")).toBe(true);
    expect(isTrustedAccountSender({ ...event, sender: {} }, owner, frame.url)).toBe(false);
    expect(isTrustedAccountSender({ ...event, senderFrame: { ...frame } }, owner, frame.url)).toBe(
      false,
    );
    expect(isTrustedAccountSender({ ...event, senderFrame: null }, owner, frame.url)).toBe(false);
    expect(isTrustedAccountSender(event, null, frame.url)).toBe(false);
    frame.url = "https://untrusted.example";
    expect(isTrustedAccountSender(event, owner, "graft://app/index.html")).toBe(false);
  });
});
