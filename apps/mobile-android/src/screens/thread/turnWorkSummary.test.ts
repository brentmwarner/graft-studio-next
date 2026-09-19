import { describe, expect, it } from "vitest";

import type { TranscriptItem } from "../../state/mobileViewModels";
import { turnWorkSummary } from "./turnWorkSummary";

function tool(id: string): TranscriptItem {
  return { id, kind: "tool", toolId: id, name: "Read", detail: "src/app.ts", running: false };
}

describe("turnWorkSummary", () => {
  it("counts folded tools the way iOS labels a settled turn", () => {
    expect(turnWorkSummary([])).toBe("Worked");
    expect(turnWorkSummary([tool("t1")])).toBe("Used 1 tool");
    expect(turnWorkSummary([tool("t1"), tool("t2")])).toBe("Used 2 tools");
  });
});
