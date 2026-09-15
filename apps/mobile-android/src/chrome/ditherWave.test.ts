import { describe, expect, it } from "vitest";

import { ditherWaveCanvas, ditherWaveSurface, ditherWaveTime } from "./ditherWave";

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
});
