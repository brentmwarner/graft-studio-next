export interface HelixG4Dot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly opacity: number;
}

/** AICSS Orbs G4 — helix/globe “Syncing”. Port of iOS `HelixG4Renderer`. */
export const HELIX_G4_STAGE = 28;
export const HELIX_G4_DEFAULT_SIZE = 20;
export const HELIX_G4_CYCLE = 2.8;
export const HELIX_G4_DOT_DIAMETER = 2;
export const HELIX_G4_GLOBE_RADIUS = 8.5;
export const HELIX_G4_TILT = (14 * Math.PI) / 180;
export const HELIX_G4_DOTS_PER_RING = 8;
export const HELIX_G4_LATITUDES = [52, 26, 0, -26, -52] as const;
export const HELIX_G4_MOVE_RINGS = [2, 1, 3, 0, 4, 2, 1, 3, 0, 4] as const;
export const HELIX_G4_ARC_STEPS = 3;
export const HELIX_G4_POSE_COUNT = 1 + HELIX_G4_MOVE_RINGS.length * HELIX_G4_ARC_STEPS;

const TILT_COS = Math.cos(HELIX_G4_TILT);
const TILT_SIN = Math.sin(HELIX_G4_TILT);

export const HELIX_G4_KEYFRAMES: readonly { readonly time: number; readonly pose: number }[] =
  (() => {
    const frames: { time: number; pose: number }[] = [{ time: 0, pose: 0 }];
    for (let pose = 1; pose <= 30; pose += 1) {
      const move = Math.floor((pose - 1) / HELIX_G4_ARC_STEPS);
      const step = (pose - 1) % HELIX_G4_ARC_STEPS;
      frames.push({ time: move * 0.1 + (step + 1) * 0.025, pose });
      if (step === HELIX_G4_ARC_STEPS - 1) {
        frames.push({ time: move * 0.1 + 0.1, pose });
      }
    }
    return frames;
  })();

export function helixG4RingDirection(ring: number): number {
  return ring % 2 === 0 ? -1 : 1;
}

function wrapProgress(progress: number): number {
  let wrapped = progress % 1;
  if (wrapped < 0) wrapped += 1;
  return wrapped;
}

export function helixG4ActiveRing(progress: number): number {
  const wrapped = wrapProgress(progress);
  const move = Math.min(HELIX_G4_MOVE_RINGS.length - 1, Math.floor(wrapped / 0.1));
  return HELIX_G4_MOVE_RINGS[move] ?? HELIX_G4_MOVE_RINGS[0];
}

function keyframeSpan(progress: number): { from: number; to: number; fraction: number } {
  const frames = HELIX_G4_KEYFRAMES;
  let index = 0;
  while (index + 1 < frames.length && (frames[index + 1]?.time ?? 0) <= progress) {
    index += 1;
  }
  const start = frames[index];
  const end = frames[index + 1];
  if (!start) return { from: 0, to: 0, fraction: 0 };
  if (!end) return { from: start.pose, to: 0, fraction: 0 };
  const span = end.time - start.time;
  const fraction = span <= 1e-12 ? 0 : (progress - start.time) / span;
  return { from: start.pose, to: end.pose, fraction };
}

function restPoint(ring: number, spoke: number): { x: number; y: number; z: number } {
  const lat = ((HELIX_G4_LATITUDES[ring] ?? 0) * Math.PI) / 180;
  const y = Math.sin(lat) * HELIX_G4_GLOBE_RADIUS;
  const ringRadius = Math.cos(lat) * HELIX_G4_GLOBE_RADIUS;
  const lon = (spoke / HELIX_G4_DOTS_PER_RING) * Math.PI * 2;
  return { x: Math.cos(lon) * ringRadius, y, z: Math.sin(lon) * ringRadius };
}

function ringTurnPoses(ring: number, spoke: number): { x: number; y: number; z: number }[] {
  let point = restPoint(ring, spoke);
  const poses = [point];
  for (const moveRing of HELIX_G4_MOVE_RINGS) {
    const start = point;
    const angle = helixG4RingDirection(moveRing) * Math.PI;
    for (let step = 1; step <= HELIX_G4_ARC_STEPS; step += 1) {
      if (ring === moveRing) {
        const a = (angle * step) / HELIX_G4_ARC_STEPS;
        point = {
          x: start.x * Math.cos(a) - start.z * Math.sin(a),
          y: start.y,
          z: start.x * Math.sin(a) + start.z * Math.cos(a),
        };
      }
      poses.push(point);
    }
  }
  return poses;
}

function globeOpacity(z: number): number {
  const t = Math.min(1, Math.max(0, (z / HELIX_G4_GLOBE_RADIUS + 0.15) / 1.15));
  return 0.12 + 0.88 * t * t;
}

function project(point: { x: number; y: number; z: number }): HelixG4Dot {
  const rotatedY = point.y * TILT_COS - point.z * TILT_SIN;
  const rotatedZ = point.y * TILT_SIN + point.z * TILT_COS;
  return {
    x: point.x,
    y: -rotatedY,
    z: rotatedZ,
    opacity: globeOpacity(rotatedZ),
  };
}

const PROJECTED_POSES: HelixG4Dot[][][] = HELIX_G4_LATITUDES.map((_, ring) =>
  Array.from({ length: HELIX_G4_DOTS_PER_RING }, (__, spoke) =>
    ringTurnPoses(ring, spoke).map(project),
  ),
);

export function helixG4Dots(progress: number): HelixG4Dot[] {
  const wrapped = wrapProgress(progress);
  const { from, to, fraction } = keyframeSpan(wrapped);
  const dots: HelixG4Dot[] = [];
  for (let ring = 0; ring < HELIX_G4_LATITUDES.length; ring += 1) {
    for (let spoke = 0; spoke < HELIX_G4_DOTS_PER_RING; spoke += 1) {
      const poses = PROJECTED_POSES[ring]?.[spoke];
      const a = poses?.[from];
      const b = poses?.[to];
      if (!a || !b) continue;
      dots.push({
        x: a.x + (b.x - a.x) * fraction,
        y: a.y + (b.y - a.y) * fraction,
        z: a.z + (b.z - a.z) * fraction,
        opacity: a.opacity + (b.opacity - a.opacity) * fraction,
      });
    }
  }
  return dots;
}

export function helixG4DotIndex(ring: number, spoke: number): number {
  return ring * HELIX_G4_DOTS_PER_RING + spoke;
}
