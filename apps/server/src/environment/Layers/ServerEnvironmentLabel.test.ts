import { describe, expect, it } from "vitest";

import { resolveServerEnvironmentLabel } from "./ServerEnvironmentLabel";

describe("resolveServerEnvironmentLabel", () => {
  it("prefers a supplied hostname", () => {
    expect(
      resolveServerEnvironmentLabel({ cwdBaseName: "workspace", hostname: "graft-host" }),
    ).toBe("graft-host");
  });

  it("falls back without querying native OS bindings", () => {
    expect(resolveServerEnvironmentLabel({ cwdBaseName: "workspace" })).toBe("workspace");
    expect(resolveServerEnvironmentLabel({ cwdBaseName: "", hostname: "  " })).toBe("Graft");
  });
});
