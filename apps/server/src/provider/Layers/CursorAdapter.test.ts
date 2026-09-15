// FILE: CursorAdapter.test.ts
// Purpose: Characterizes Cursor's private Graft host-policy delivery.
// Layer: Provider adapter tests

import { GRAFT_HARNESS_POLICY_MARKER } from "../../agentGateway/harnessPolicy.ts";
import { describe, expect, it } from "vitest";

import { takeCursorGraftHarnessPolicyTextPart } from "./CursorAdapter.ts";

describe("Cursor Graft harness policy", () => {
  it("delivers scoped MCP host context exactly once per fresh/load/fork session", () => {
    for (const lifecycle of ["fresh", "load", "fork"] as const) {
      const state: { harnessPolicyDelivered?: boolean } = {};
      const first = takeCursorGraftHarnessPolicyTextPart(state, true);
      expect(first?.text, lifecycle).toContain(GRAFT_HARNESS_POLICY_MARKER);
      expect(first?.text, lifecycle).toContain("Use the graft_* tools");
      expect(takeCursorGraftHarnessPolicyTextPart(state, true), lifecycle).toBeNull();
    }
  });

  it("stays truthful without a scoped gateway connection", () => {
    expect(takeCursorGraftHarnessPolicyTextPart({}, false)?.text).toContain(
      "Graft MCP control is unavailable",
    );
  });
});
