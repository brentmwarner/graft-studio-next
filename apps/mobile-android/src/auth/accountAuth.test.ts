import { describe, expect, it } from "vitest";

import { developmentAccountFixture } from "./accountAuth";

describe("developmentAccountFixture", () => {
  it("cannot enable an account outside a development bundle", () => {
    expect(developmentAccountFixture(false, "simulator@graft.local")).toBeNull();
  });

  it("requires an explicit non-empty development email", () => {
    expect(developmentAccountFixture(true)).toBeNull();
    expect(developmentAccountFixture(true, "   ")).toBeNull();
  });

  it("unlocks development onboarding without accepting a real credential", () => {
    expect(developmentAccountFixture(true, " simulator@graft.local ")).toEqual({
      email: "simulator@graft.local",
      token: "development-account-fixture",
    });
  });
});
