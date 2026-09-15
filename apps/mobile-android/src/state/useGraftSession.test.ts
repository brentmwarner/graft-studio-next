import { describe, expect, it } from "vitest";

import { withGatewayConnection } from "./sessionConnectionState";

const pairedState = {
  connectionState: "reconnecting",
  error: "Could not reach the previous host.",
  marker: "preserved",
} as const;

describe("withGatewayConnection", () => {
  it("clears an obsolete transport error after a successful welcome", () => {
    expect(withGatewayConnection(pairedState, "connected")).toEqual({
      ...pairedState,
      connectionState: "connected",
      error: undefined,
    });
  });

  it("preserves the error while the transport is still reconnecting", () => {
    expect(withGatewayConnection(pairedState, "reconnecting").error).toBe(
      "Could not reach the previous host.",
    );
  });
});
