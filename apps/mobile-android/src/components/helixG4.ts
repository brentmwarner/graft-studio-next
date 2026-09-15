export const HELIX_G4_STAGE = 28;
export const HELIX_G4_CYCLE_MS = 2_800;
export const HELIX_G4_DOT_DIAMETER = 2;
export const HELIX_G4_LATITUDES = [52, 26, 0, -26, -52] as const;
export const HELIX_G4_DOTS_PER_RING = 8;

const GLOBE_RADIUS = 8.5;
const TILT = (14 * Math.PI) / 180;
const MOVE_RINGS = [2, 1, 3, 0, 4, 2, 1, 3, 0, 4] as const;

export interface HelixG4DotPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly opacity: number;
}

function ringDirection(ring: number): number {
  "worklet";
  return ring % 2 === 0 ? -1 : 1;
}

/** Pure G4 globe geometry shared by the renderer and regression tests. */
export function helixG4DotPosition(
  ring: number,
  spoke: number,
  rawProgress: number,
): HelixG4DotPosition {
  "worklet";
  const progress = ((rawProgress % 1) + 1) % 1;
  const movePosition = progress * MOVE_RINGS.length;
  const moveIndex = Math.min(MOVE_RINGS.length - 1, Math.floor(movePosition));
  const segment = movePosition - moveIndex;
  let longitudeTurn = 0;
  for (let index = 0; index < moveIndex; index += 1) {
    if (MOVE_RINGS[index] === ring) longitudeTurn += ringDirection(ring) * Math.PI;
  }
  if (MOVE_RINGS[moveIndex] === ring) {
    longitudeTurn += ringDirection(ring) * Math.PI * Math.min(1, segment / 0.75);
  }

  const latitude = (HELIX_G4_LATITUDES[ring]! * Math.PI) / 180;
  const longitude = (spoke / HELIX_G4_DOTS_PER_RING) * Math.PI * 2 + longitudeTurn;
  const ringRadius = Math.cos(latitude) * GLOBE_RADIUS;
  const x = Math.cos(longitude) * ringRadius;
  const sourceY = Math.sin(latitude) * GLOBE_RADIUS;
  const sourceZ = Math.sin(longitude) * ringRadius;
  const rotatedY = sourceY * Math.cos(TILT) - sourceZ * Math.sin(TILT);
  const z = sourceY * Math.sin(TILT) + sourceZ * Math.cos(TILT);
  const depth = Math.min(1, Math.max(0, (z / GLOBE_RADIUS + 0.15) / 1.15));
  return { x, y: -rotatedY, z, opacity: 0.12 + 0.88 * depth * depth };
}
