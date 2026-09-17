import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import type { UtilityProcess } from "electron";
import { describe, expect, it, vi } from "vitest";

import { UtilityDesktopBackendProcess } from "./desktopBackendProcess";

class FakeUtilityProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  pid: number | undefined = 4242;
  readonly kill = vi.fn(() => true);
}

describe("desktop backend process", () => {
  it("adapts utility-process exit state and output streams for supervision", () => {
    const utility = new FakeUtilityProcess();
    const backend = new UtilityDesktopBackendProcess(utility as unknown as UtilityProcess);
    const onExit = vi.fn();
    backend.on("exit", onExit);

    expect(backend.pid).toBe(4242);
    expect(backend.stdout).toBe(utility.stdout);
    expect(backend.stderr).toBe(utility.stderr);
    expect(backend.kill()).toBe(true);
    expect(utility.kill).toHaveBeenCalledOnce();

    utility.emit("exit", 0);

    expect(backend.exitCode).toBe(0);
    expect(backend.signalCode).toBeNull();
    expect(backend.pid).toBeUndefined();
    expect(onExit).toHaveBeenCalledExactlyOnceWith(0, null);
  });

  it("turns utility fatal errors into ordinary supervisor errors", () => {
    const utility = new FakeUtilityProcess();
    const backend = new UtilityDesktopBackendProcess(utility as unknown as UtilityProcess);
    const onError = vi.fn();
    backend.on("error", onError);

    utility.emit("error", "FatalError", "startup", "report");

    expect(onError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: "Backend utility process failed: FatalError: startup: report",
      }),
    );
  });
});
