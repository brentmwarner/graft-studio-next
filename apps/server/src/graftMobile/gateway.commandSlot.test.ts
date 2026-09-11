import { describe, expect, it } from "vitest";
import type { GraftMobileHostMessage } from "@graft/mobile-contract";

import {
  abortMobileCommand,
  claimMobileCommand,
  closedMobileCommandResponse,
  makeGraftMobileGatewayState,
} from "./gateway";

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

  it("rejects waiters on abort without caching so a retry can run again", async () => {
    const state = makeGraftMobileGatewayState();
    const first = claimMobileCommand(state, "command-2");
    const second = claimMobileCommand(state, "command-2");
    expect(first.kind).toBe("reserved");
    expect(second.kind).toBe("pending");
    if (first.kind !== "reserved" || second.kind !== "pending") return;

    const closed = closedMobileCommandResponse("command-2");
    abortMobileCommand(state, "command-2", closed);
    await expect(second.promise).resolves.toEqual(closed);
    expect(claimMobileCommand(state, "command-2").kind).toBe("reserved");
  });
});
