import { describe, expect, it } from "vitest";

import {
  ditherWaveCanvas,
  ditherWaveInputKey,
  ditherWaveSurface,
  ditherWaveTime,
  shouldContinueDitherWaveLoop,
} from "./ditherWave";

describe("ditherWave", () => {
  it("uses the native 60 Hz UnicornStudio time units", () => {
    expect(ditherWaveTime(2, false)).toBeCloseTo(13.2);
    expect(ditherWaveTime(8, true)).toBe(0);
  });

  it("matches the Metal surface and canvas tokens", () => {
    expect(ditherWaveSurface(true)).toBeCloseTo(14 / 255);
    expect(ditherWaveSurface(false)).toBeCloseTo(252 / 255);
    expect(ditherWaveCanvas(true)).toBeCloseTo(23 / 255);
    expect(ditherWaveCanvas(false)).toBe(1);
  });

  it("stops the continuous wave loop when Reduce Motion is on", () => {
    expect(shouldContinueDitherWaveLoop(false)).toBe(true);
    expect(shouldContinueDitherWaveLoop(true)).toBe(false);
    expect(
      ditherWaveInputKey({
        dark: true,
        hasGlyphs: false,
        height: 800,
        reduceMotion: true,
        width: 400,
      }),
    ).not.toEqual(
      ditherWaveInputKey({
        dark: false,
        hasGlyphs: true,
        height: 800,
        reduceMotion: true,
        width: 400,
      }),
    );
  });
});
