import { describe, expect, it } from "vitest";
import type { GraftMobileHostMessage } from "@graft/mobile-contract";

import { claimMobileCommand, makeGraftMobileGatewayState } from "./gateway";

function responseFor(commandId: string, status: "completed" | "rejected"): GraftMobileHostMessage {
  return {
    envelope: "response",
    commandId,
    receipt: {
      commandId,
      status,
    },
  };
}

describe("mobile command idempotency", () => {
  it("reserves a command id before execute so a second socket joins the same work", async () => {
    const state = makeGraftMobileGatewayState();
    const first = claimMobileCommand(state, "command-1");
    const second = claimMobileCommand(state, "command-1");
    expect(first.kind).toBe("reserved");
    expect(second.kind).toBe("pending");
    if (first.kind !== "reserved" || second.kind !== "pending") return;

    const joined = second.promise;
    const result = responseFor("command-1", "completed");
    first.complete(result);
    await expect(joined).resolves.toEqual(result);
    expect(claimMobileCommand(state, "command-1")).toEqual({
      kind: "cached",
      response: result,
    });
  });
});
