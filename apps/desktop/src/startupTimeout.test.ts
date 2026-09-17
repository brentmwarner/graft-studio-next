import { afterEach, describe, expect, it, vi } from "vitest";

import { withStartupTimeout } from "./startupTimeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("withStartupTimeout", () => {
  it("returns a task result before the deadline", async () => {
    await expect(withStartupTimeout(async () => "ready", 100, "startup task")).resolves.toBe(
      "ready",
    );
  });

  it("preserves task failures", async () => {
    const failure = new Error("listen failed");
    await expect(
      withStartupTimeout(async () => Promise.reject(failure), 100, "startup task"),
    ).rejects.toBe(failure);
  });

  it("aborts and rejects a task that does not settle before the deadline", async () => {
    vi.useFakeTimers();
    let taskSignal: AbortSignal | undefined;
    const result = withStartupTimeout(
      (signal) => {
        taskSignal = signal;
        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      5_000,
      "browser pipe",
    );
    const assertion = expect(result).rejects.toThrow("browser pipe timed out after 5000ms.");

    await vi.advanceTimersByTimeAsync(5_000);

    await assertion;
    expect(taskSignal?.aborted).toBe(true);
  });
});
