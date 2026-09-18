import { describe, expect, it } from "vitest";

import {
  HELIX_G4_CYCLE,
  HELIX_G4_DOTS_PER_RING,
  HELIX_G4_KEYFRAMES,
  HELIX_G4_LATITUDES,
  HELIX_G4_MOVE_RINGS,
  HELIX_G4_POSE_COUNT,
  helixG4ActiveRing,
  helixG4DotIndex,
  helixG4Dots,
  helixG4RingDirection,
  type HelixG4Dot,
} from "./helixG4";

function assertNear(left: HelixG4Dot, right: HelixG4Dot) {
  expect(Math.abs(left.x - right.x)).toBeLessThan(1e-5);
  expect(Math.abs(left.y - right.y)).toBeLessThan(1e-5);
  expect(Math.abs(left.z - right.z)).toBeLessThan(1e-5);
  expect(Math.abs(left.opacity - right.opacity)).toBeLessThan(1e-5);
}

describe("Helix G4 orb", () => {
  it("has five rings of eight dots", () => {
    const dots = helixG4Dots(0);
    expect(dots).toHaveLength(40);
    expect(HELIX_G4_LATITUDES).toHaveLength(5);
    expect(HELIX_G4_DOTS_PER_RING).toBe(8);
    expect(HELIX_G4_POSE_COUNT).toBe(31);
    expect(HELIX_G4_KEYFRAMES).toHaveLength(41);
    expect(HELIX_G4_CYCLE).toBe(2.8);
  });

  it("turns even rings negative and odd rings positive", () => {
    expect(helixG4RingDirection(0)).toBe(-1);
    expect(helixG4RingDirection(1)).toBe(1);
    expect(helixG4RingDirection(2)).toBe(-1);
    expect(helixG4RingDirection(3)).toBe(1);
    expect(helixG4RingDirection(4)).toBe(-1);
  });

  it("follows the AICSS G4 move sequence", () => {
    expect([...HELIX_G4_MOVE_RINGS]).toEqual([2, 1, 3, 0, 4, 2, 1, 3, 0, 4]);
    expect(helixG4ActiveRing(0)).toBe(2);
    expect(helixG4ActiveRing(0.05)).toBe(2);
    expect(helixG4ActiveRing(0.1)).toBe(1);
    expect(helixG4ActiveRing(0.2)).toBe(3);
    expect(helixG4ActiveRing(0.99)).toBe(4);
  });

  it("matches the AICSS rest pose", () => {
    const dots = helixG4Dots(0);
    assertNear(dots[helixG4DotIndex(2, 0)]!, {
      x: 8.5,
      y: 0,
      z: 0,
      opacity: 0.134972,
    });
    assertNear(dots[helixG4DotIndex(2, 2)]!, {
      x: 0,
      y: 2.056336,
      z: 8.247514,
      opacity: 0.955127,
    });
    assertNear(dots[helixG4DotIndex(0, 0)]!, {
      x: 5.233123,
      y: -6.499129,
      z: 1.620415,
      opacity: 0.19721,
    });
    assertNear(dots[helixG4DotIndex(1, 0)]!, {
      x: 7.639749,
      y: -3.615472,
      z: 0.901438,
      opacity: 0.163626,
    });
    assertNear(dots[helixG4DotIndex(4, 0)]!, {
      x: 5.233123,
      y: 6.499129,
      z: -1.620415,
      opacity: 0.12,
    });
  });

  it("flips the lead equator dot on the first turn", () => {
    const mid = helixG4Dots(0.05);
    assertNear(mid[helixG4DotIndex(2, 0)]!, {
      x: -4.25,
      y: -1.780839,
      z: -7.142556,
      opacity: 0.12,
    });
    const still = helixG4Dots(0);
    assertNear(mid[helixG4DotIndex(1, 0)]!, still[helixG4DotIndex(1, 0)]!);
    assertNear(mid[helixG4DotIndex(0, 0)]!, still[helixG4DotIndex(0, 0)]!);

    const settled = helixG4Dots(0.1);
    assertNear(settled[helixG4DotIndex(2, 0)]!, {
      x: -8.5,
      y: 0,
      z: 0,
      opacity: 0.134972,
    });
    assertNear(settled[helixG4DotIndex(1, 0)]!, still[helixG4DotIndex(1, 0)]!);
  });

  it("turns the northern mid ring on the second move", () => {
    const dots = helixG4Dots(0.2);
    assertNear(dots[helixG4DotIndex(1, 0)]!, {
      x: -7.639749,
      y: -3.615472,
      z: 0.901438,
      opacity: 0.163626,
    });
  });

  it("keeps front dots brighter than back dots", () => {
    const dots = helixG4Dots(0);
    const front = dots.reduce((best, dot) => (dot.z > best.z ? dot : best));
    const back = dots.reduce((best, dot) => (dot.z < best.z ? dot : best));
    expect(front.opacity).toBeGreaterThan(back.opacity);
  });

  it("wraps progress 1 to the rest pose", () => {
    const rest = helixG4Dots(0);
    const wrapped = helixG4Dots(1);
    for (const [index, dot] of rest.entries()) {
      assertNear(dot, wrapped[index]!);
    }
  });
});
