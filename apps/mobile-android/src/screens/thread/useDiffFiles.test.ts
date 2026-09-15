import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraftDiffSummary } from "@graft/mobile-contract";

import { useDiffFiles } from "./useDiffFiles";

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
