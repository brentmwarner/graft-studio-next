import {
  createElement,
  startTransition,
  StrictMode,
  Suspense,
  useEffect,
  useLayoutEffect,
} from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GraftModelOption } from "@graft/mobile-contract";

import { useModelCatalog } from "./useModelCatalog";

const models: GraftModelOption[] = [{ providerId: "codex", id: "model", label: "Model" }];
let catalog: ReturnType<typeof useModelCatalog>;
let renderer: ReactTestRenderer | undefined;
const request = vi.fn<() => Promise<readonly GraftModelOption[]>>();
function AutoLoad({ load }: { load: () => Promise<void> }) {
  useEffect(() => {
    void load();
  }, [load]);
  return null;
}
function Harness({ sessionId = "a", auto = false }: { sessionId?: string; auto?: boolean }) {
  catalog = useModelCatalog(sessionId, request);
  return auto ? createElement(AutoLoad, { load: catalog.load }) : null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockReset();
});
afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("deduplicates concurrent discovery and reuses the catalog until explicit refresh", async () => {
  request.mockResolvedValue(models);
  await act(() => {
    renderer = create(createElement(Harness));
  });
  await act(async () => {
    await Promise.all([catalog.load(), catalog.load()]);
  });
  expect(request).toHaveBeenCalledOnce();
  expect(catalog.models).toEqual(models);
  await act(() => catalog.load());
  expect(request).toHaveBeenCalledOnce();
  await act(() => catalog.load(true));
  expect(request).toHaveBeenCalledTimes(2);
});

it("shows retryable discovery errors and keeps the last usable catalog", async () => {
  request
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(models)
    .mockRejectedValueOnce(new Error("timeout"));
  await act(() => {
    renderer = create(createElement(Harness));
  });
  await act(() => catalog.load());
  expect(catalog.error).toContain("Couldn’t load models");
  expect(catalog.loading).toBe(false);
  await act(() => catalog.load(true));
  expect(catalog.models).toEqual(models);
  expect(catalog.error).toBeUndefined();
  await act(() => catalog.load(true));
  expect(catalog.models).toEqual(models);
  expect(catalog.error).toBeDefined();
});

it("does not let a previous host overwrite the current host catalog", async () => {
  let finish!: (value: GraftModelOption[]) => void;
  request
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce([{ ...models[0]!, providerId: "claudeAgent" }]);
  await act(() => {
    renderer = create(createElement(Harness, { auto: true }));
  });
  expect(catalog.loading).toBe(true);
  await act(async () => renderer!.update(createElement(Harness, { sessionId: "b", auto: true })));
  await act(async () => finish(models));
  expect(catalog.models[0]?.providerId).toBe("claudeAgent");
  expect(catalog.loading).toBe(false);
});

it("keeps the committed host usable when a new session render suspends", async () => {
  request.mockResolvedValue(models);
  let committedCatalog!: ReturnType<typeof useModelCatalog>;
  const suspended = new Promise<void>(() => {});
  let attemptedSession: string | undefined;
  function SuspendedSession({ sessionId }: { sessionId: string }) {
    const current = useModelCatalog(sessionId, request);
    useLayoutEffect(() => {
      committedCatalog = current;
    });
    attemptedSession = sessionId;
    if (sessionId === "b") throw suspended;
    return createElement("span", null, sessionId);
  }
  const view = (sessionId: string) =>
    createElement(
      Suspense,
      { fallback: "Loading session" },
      createElement(SuspendedSession, { sessionId }),
    );
  await act(() => {
    renderer = create(view("a"));
  });
  const loadCommittedSession = committedCatalog.load;
  await act(() => {
    startTransition(() => renderer!.update(view("b")));
  });
  expect(attemptedSession).toBe("b");
  expect(renderer!.toJSON()).toEqual({ type: "span", props: {}, children: ["a"] });

  await act(() => loadCommittedSession());
  expect(request).toHaveBeenCalledOnce();
  expect(committedCatalog.models).toEqual(models);
  expect(committedCatalog.loading).toBe(false);
});

it("reports an empty catalog and allows discovery again", async () => {
  request.mockResolvedValueOnce([]).mockResolvedValueOnce(models);
  await act(() => {
    renderer = create(createElement(Harness));
  });
  await act(() => catalog.load());
  expect(catalog.error).toContain("No models available");
  await act(() => catalog.load());
  expect(catalog.models).toEqual(models);
});

it("accepts child-triggered discovery through strict-mode effect replay", async () => {
  request.mockResolvedValue(models);
  await act(async () => {
    renderer = create(createElement(StrictMode, null, createElement(Harness, { auto: true })));
  });
  expect(catalog.models).toEqual(models);
  expect(catalog.loading).toBe(false);
});
