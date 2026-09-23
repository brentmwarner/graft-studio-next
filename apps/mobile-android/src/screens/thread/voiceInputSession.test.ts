import { describe, expect, it, vi } from "vitest";

import { createVoiceInputSession } from "./voiceInputSession";

function setup() {
  const listeners = new Map<string, (event: unknown) => void>();
  const native = {
    addListener: vi.fn((name: string, callback: (event: unknown) => void) => {
      listeners.set(name, callback);
      return { remove: () => listeners.delete(name) };
    }),
    isRecognitionAvailable: vi.fn(() => true),
    requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
  };
  const onState = vi.fn();
  const onDraft = vi.fn();
  const isForeground = vi.fn(() => true);
  const session = createVoiceInputSession(
    native as unknown as Parameters<typeof createVoiceInputSession>[0],
    onState,
    onDraft,
    isForeground,
  );
  const emit = (name: string, payload: unknown = null) => listeners.get(name)?.(payload);
  const result = (transcript: string, isFinal = false) =>
    emit("result", { isFinal, results: [{ transcript }] });
  return { native, onState, onDraft, session, emit, result, isForeground };
}

describe("voice input", () => {
  it.each([true, false])(
    "survives the Android permission Activity (permission resolves before resume: %s)",
    async (permissionFirst) => {
      const { session, native, isForeground, emit } = setup();
      let grant!: (value: { granted: boolean }) => void;
      native.requestPermissionsAsync.mockImplementation(
        () =>
          new Promise((resolve) => {
            grant = resolve;
          }),
      );
      const pending = session.start("");
      isForeground.mockReturnValue(false);
      session.pause();
      if (permissionFirst) {
        grant({ granted: true });
        await pending;
        expect(native.start).not.toHaveBeenCalled();
      }
      isForeground.mockReturnValue(true);
      session.resume();
      if (!permissionFirst) {
        grant({ granted: true });
        await pending;
      }
      expect(native.start).toHaveBeenCalledOnce();
      emit("start");
      isForeground.mockReturnValue(false);
      session.pause();
      expect(native.abort).toHaveBeenCalledOnce();
      emit("end");
      isForeground.mockReturnValue(true);
      session.resume();
      expect(native.start).toHaveBeenCalledOnce();
    },
  );

  it("requests permission, replaces interim text, and accepts the final result after stop", async () => {
    const { session, native, emit, result, onDraft, onState } = setup();
    await session.start("Please");
    expect(native.requestPermissionsAsync).toHaveBeenCalledOnce();
    expect(native.start).toHaveBeenCalledWith(
      expect.objectContaining({ interimResults: true, continuous: true }),
    );
    emit("start");
    expect(onState).toHaveBeenLastCalledWith({ phase: "listening" });
    result("fix");
    result("fix the header");
    expect(onDraft).toHaveBeenLastCalledWith("Please fix the header");
    const completion = session.stop();
    expect(native.stop).toHaveBeenCalledOnce();
    expect(onState).toHaveBeenLastCalledWith({ phase: "stopping" });
    result("fix the header.", true);
    emit("end");
    expect(onDraft).toHaveBeenLastCalledWith("Please fix the header.");
    expect(onState).toHaveBeenLastCalledWith({ phase: "idle" });
    await expect(completion).resolves.toBe("Please fix the header.");
  });

  it("keeps listening through pauses and joins every finalized segment", async () => {
    const { session, native, emit, result, onDraft, onState } = setup();
    await session.start("Please");
    emit("start");
    result("fix the");
    result("fix the header", true);
    expect(onDraft).toHaveBeenLastCalledWith("Please fix the header");
    // A silent stretch finalizes an empty segment without ending the session.
    emit("nomatch");
    expect(onState).toHaveBeenLastCalledWith({ phase: "listening" });
    expect(native.abort).not.toHaveBeenCalled();
    result("and the");
    expect(onDraft).toHaveBeenLastCalledWith("Please fix the header and the");
    result("and the footer.", true);
    expect(onDraft).toHaveBeenLastCalledWith("Please fix the header and the footer.");
    const completion = session.stop();
    emit("end");
    await expect(completion).resolves.toBe("Please fix the header and the footer.");
  });

  it("delivers finalized segments when stopping during a pause reports no speech", async () => {
    const { session, emit, result, onState } = setup();
    await session.start("");
    emit("start");
    result("Ship it", true);
    const completion = session.stop();
    emit("error", { error: "no-speech" });
    emit("end");
    await expect(completion).resolves.toBe("Ship it");
    expect(onState).toHaveBeenLastCalledWith({ phase: "idle" });
  });

  it("does not send interim text, failed recognition, or cancelled recordings", async () => {
    for (const outcome of ["interim", "error", "cancel", "dispose"]) {
      const { session, emit, result } = setup();
      await session.start("");
      emit("start");
      result("Do not send this yet");
      const completion = session.stop();
      expect(session.stop()).toBe(completion);
      if (outcome === "error") emit("error", { error: "network" });
      if (outcome === "cancel") session.cancel();
      if (outcome === "dispose") session.dispose();
      emit("end");
      await expect(completion).resolves.toBeUndefined();
    }
  });

  it("shows permission and unavailable-service errors instead of silently doing nothing", async () => {
    const { session, native, onState } = setup();
    native.requestPermissionsAsync.mockResolvedValueOnce({ granted: false });
    await session.start("");
    expect(native.start).not.toHaveBeenCalled();
    expect(onState).toHaveBeenLastCalledWith({
      phase: "idle",
      error: expect.stringContaining("microphone access"),
    });
    native.isRecognitionAvailable.mockReturnValue(false);
    await session.start("");
    expect(onState).toHaveBeenLastCalledWith({
      phase: "idle",
      error: expect.stringContaining("speech recognition service"),
    });
  });

  it("ignores permission completion after cancellation or leaving the thread", async () => {
    for (const dispose of [false, true]) {
      const { session, native } = setup();
      let grant!: (value: { granted: boolean }) => void;
      native.requestPermissionsAsync.mockImplementation(
        () =>
          new Promise((resolve) => {
            grant = resolve;
          }),
      );
      const pending = session.start("");
      if (dispose) session.dispose();
      else session.cancel();
      grant({ granted: true });
      await pending;
      expect(native.start).not.toHaveBeenCalled();
    }
  });

  it("blocks duplicate starts and late results from cancelled recordings", async () => {
    const { session, native, emit, result, onDraft } = setup();
    await session.start("Original draft");
    await session.start("Duplicate");
    expect(native.start).toHaveBeenCalledOnce();
    emit("start");
    result("dictated words");
    session.cancel();
    expect(native.abort).toHaveBeenCalledOnce();
    expect(onDraft).toHaveBeenLastCalledWith("Original draft");
    result("late words", true);
    await session.start("Too early");
    expect(native.start).toHaveBeenCalledOnce();
    expect(onDraft).toHaveBeenLastCalledWith("Original draft");
    emit("end");
    await session.start("Next draft");
    expect(native.start).toHaveBeenCalledTimes(2);
  });

  it("retains captured text on interruption and releases listeners on disposal", async () => {
    const { session, native, emit, result, onDraft, onState } = setup();
    await session.start("");
    emit("start");
    result("Keep this");
    session.cancel(false);
    result("Do not append");
    expect(onDraft).toHaveBeenLastCalledWith("Keep this");
    session.dispose();
    onState.mockClear();
    emit("end");
    expect(onState).not.toHaveBeenCalled();
    expect(native.abort).toHaveBeenCalled();
  });

  it("surfaces native failure and allows another recording after end", async () => {
    const { session, emit, onState, native } = setup();
    await session.start("");
    emit("error", { error: "no-speech" });
    emit("end");
    expect(onState).toHaveBeenLastCalledWith({
      phase: "idle",
      error: expect.stringContaining("No speech"),
    });
    await session.start("");
    expect(native.start).toHaveBeenCalledTimes(2);
    expect(onState).toHaveBeenLastCalledWith({ phase: "starting" });
  });

  it("restarts continuous capture when the recognizer ends during an open recording", async () => {
    const { session, native, emit, result, onDraft, onState } = setup();
    await session.start("Please");
    emit("start");
    // A long-silence timeout can emit end with no stop, cancel, or error.
    emit("nomatch");
    emit("end");
    expect(native.start).toHaveBeenCalledTimes(2);
    expect(native.stop).not.toHaveBeenCalled();
    expect(native.abort).not.toHaveBeenCalled();
    expect(onState).toHaveBeenLastCalledWith({ phase: "listening" });
    result("fix the");
    emit("end");
    expect(onDraft).toHaveBeenLastCalledWith("Please fix the");
    expect(native.start).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ interimResults: true, continuous: true }),
    );
    expect(onState).toHaveBeenLastCalledWith({ phase: "listening" });
    result("footer", true);
    expect(onDraft).toHaveBeenLastCalledWith("Please fix the footer");
    const completion = session.stop();
    emit("end");
    await expect(completion).resolves.toBe("Please fix the footer");
    expect(onState).toHaveBeenLastCalledWith({ phase: "idle" });
    expect(native.start).toHaveBeenCalledTimes(3);
  });

  it("reports empty recognition results instead of silently returning to idle", async () => {
    const { session, emit, onState } = setup();
    await session.start("");
    emit("start");
    emit("nomatch");
    const completion = session.stop();
    emit("end");
    await expect(completion).resolves.toBeUndefined();
    expect(onState).toHaveBeenLastCalledWith({
      phase: "idle",
      error: expect.stringContaining("No speech"),
    });
  });

  it("cleans up a failed native start before accepting another recording", async () => {
    const { session, native, emit, onState } = setup();
    native.start.mockImplementationOnce(() => {
      throw new Error("Native startup failed");
    });
    await session.start("");
    expect(native.abort).toHaveBeenCalledOnce();
    await session.start("");
    expect(native.start).toHaveBeenCalledOnce();
    emit("end");
    expect(onState).toHaveBeenLastCalledWith({
      phase: "idle",
      error: expect.stringContaining("Could not start dictation"),
    });
    await session.start("");
    expect(native.start).toHaveBeenCalledTimes(2);
  });
});
