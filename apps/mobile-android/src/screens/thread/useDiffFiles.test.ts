import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraftDiffSummarySchema, type GraftDiffSummary } from "@graft/mobile-contract";

import { mobileWorkingDiff } from "../../../../server/src/graftMobile/workingDiff";

import { matchesDiffResponse, useDiffFiles } from "./useDiffFiles";

const summary: GraftDiffSummary = {
  id: "diff",
  threadId: "t",
  runId: "r1",
  updatedAt: 1,
  files: [
    { path: "first.ts", status: "modified" },
    { path: "second.ts", status: "added" },
  ],
};
const detailed = {
  ...summary,
  files: summary.files.map((file) => ({ ...file, detailStatus: "ready" as const, hunks: [] })),
};
let renderer: ReactTestRenderer;
let state: ReturnType<typeof useDiffFiles>;
function Harness({
  diff = summary,
  visible = true,
  load,
}: {
  diff?: GraftDiffSummary;
  visible?: boolean;
  load: (thread: string, path: string) => Promise<GraftDiffSummary | undefined>;
}) {
  state = useDiffFiles(diff, visible, load);
  return null;
}
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("expanded diff file loading", () => {
  it("loads only the first file, then caches other files on expansion", async () => {
    const load = vi.fn(async () => detailed);
    await act(async () => {
      renderer = create(createElement(Harness, { load }));
    });
    expect(load).toHaveBeenCalledExactlyOnceWith("t", "first.ts");
    await act(async () => state.toggle("second.ts"));
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => state.toggle("second.ts"));
    await act(async () => state.toggle("second.ts"));
    expect(load).toHaveBeenCalledTimes(2);
    await act(() => renderer.update(createElement(Harness, { load, diff: { ...summary } })));
    expect(state.expanded.has("second.ts")).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("rejects a reply for a newer checkpoint and allows retry", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ ...detailed, updatedAt: 2 })
      .mockResolvedValueOnce(detailed);
    await act(async () => {
      renderer = create(createElement(Harness, { load }));
    });
    expect(state.files["first.ts"]?.failed).toBe(true);
    await act(async () => state.request("first.ts", true));
    expect(state.files["first.ts"]?.file?.detailStatus).toBe("ready");
  });
  it("ignores a response after the sheet closes", async () => {
    let resolve!: (value: GraftDiffSummary) => void;
    const load = vi.fn(
      () =>
        new Promise<GraftDiffSummary>((done) => {
          resolve = done;
        }),
    );
    await act(() => {
      renderer = create(createElement(Harness, { load }));
    });
    await act(() => renderer.update(createElement(Harness, { load, visible: false })));
    await act(async () => resolve(detailed));
    expect(state.files).toEqual({});
    expect(state.expanded.size).toBe(0);
  });
});

// Regression: the summary and a live file read have distinct request timestamps.
it("loads ready working-tree hunks from a later read of the same thread", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  const tree = {
    files: [{ path: "first.ts", insertions: 1, deletions: 0 }],
    insertions: 1,
    deletions: 0,
  };
  const diff = mobileWorkingDiff("t", tree, " M first.ts\0");
  clock.mockReturnValue(2000);
  const response = mobileWorkingDiff("t", tree, " M first.ts\0");
  response.files[0] = {
    ...response.files[0]!,
    detailStatus: "ready",
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        collapsedBefore: 0,
        lines: [{ kind: "addition", text: "new content", newLine: 1 }],
      },
    ],
  };
  await act(async () => {
    renderer = create(
      createElement(Harness, { diff, load: async () => GraftDiffSummarySchema.parse(response) }),
    );
  });
  expect(state.files["first.ts"]?.failed).toBe(false);
  expect(state.files["first.ts"]?.file?.hunks?.[0]?.lines[0]?.text).toBe("new content");
});

it("accepts pre-source-field working hosts but rejects other threads, older reads and checkpoints", () => {
  const working = { ...summary, runId: undefined, title: "Working changes" };
  expect(matchesDiffResponse(working, { ...working, updatedAt: 2 })).toBe(true);
  expect(matchesDiffResponse(working, { ...working, threadId: "other", updatedAt: 2 })).toBe(false);
  expect(matchesDiffResponse(working, { ...working, id: "other", updatedAt: 2 })).toBe(false);
  expect(matchesDiffResponse(working, { ...working, updatedAt: 0 })).toBe(false);
  expect(matchesDiffResponse(working, { ...working, source: "checkpoint", updatedAt: 2 })).toBe(
    false,
  );
  expect(matchesDiffResponse(summary, { ...summary, source: "working-tree" })).toBe(false);
});

it("discards a working file response when the summary is refreshed", async () => {
  const diff = { ...summary, source: "working-tree" as const, runId: undefined };
  let finish!: (value: GraftDiffSummary) => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ ...diff, updatedAt: 3, files: detailed.files });
  await act(() => {
    renderer = create(createElement(Harness, { diff, load }));
  });
  await act(async () =>
    renderer.update(createElement(Harness, { diff: { ...diff, updatedAt: 2 }, load })),
  );
  await act(async () =>
    finish({ ...diff, updatedAt: 4, files: [{ ...diff.files[0]!, detailStatus: "unavailable" }] }),
  );
  expect(state.files["first.ts"]?.file?.detailStatus).toBe("ready");
});
