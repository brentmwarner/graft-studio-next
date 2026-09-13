import { describe, expect, it, vi } from "vitest";

import { createKeepHostAwakeController } from "./keepHostAwake";

describe("keep host awake", () => {
  it("starts a wake blocker only while the gateway is enabled", () => {
    const powerSaveBlocker = {
      start: vi.fn(() => 7),
      stop: vi.fn(() => true),
    };
    const controller = createKeepHostAwakeController({
      store: { load: () => false, save: vi.fn() },
      powerSaveBlocker,
    });

    expect(controller.setKeepHostAwake(true, false)).toEqual({
      keepHostAwake: true,
      blocking: false,
    });
    expect(powerSaveBlocker.start).not.toHaveBeenCalled();

    expect(controller.sync(true)).toEqual({ keepHostAwake: true, blocking: true });
    expect(powerSaveBlocker.start).toHaveBeenCalledWith("prevent-app-suspension");

    expect(controller.sync(false)).toEqual({ keepHostAwake: true, blocking: false });
    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(7);
  });
});
