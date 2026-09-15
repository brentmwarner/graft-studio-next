import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { helixG4DotPosition } from "../../components/helixG4";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const iosThreadSurfaces = [
  resolve(sourceDirectory, "../../components/ProgressRing.ios.tsx"),
  resolve(sourceDirectory, "../../components/LiveStatusLine.ios.tsx"),
  resolve(sourceDirectory, "UsageMenu.ios.tsx"),
  resolve(sourceDirectory, "DiffSheet.tsx"),
] as const;

describe("iOS thread native boundary", () => {
  it("never loads Android Jetpack Compose from an iOS-resolved thread surface", () => {
    for (const file of iosThreadSurfaces) {
      expect(readFileSync(file, "utf8"), file).not.toContain("@expo/ui/jetpack-compose");
    }
  });

  it("keeps the native five-by-eight G4 orb geometry finite throughout a cycle", () => {
    for (const progress of [0, 0.075, 0.1, 0.475, 0.999]) {
      const dots = Array.from({ length: 5 }, (_ring, ring) =>
        Array.from({ length: 8 }, (_spoke, spoke) => helixG4DotPosition(ring, spoke, progress)),
      ).flat();
      expect(dots).toHaveLength(40);
      expect(dots.every((dot) => Object.values(dot).every(Number.isFinite))).toBe(true);
      expect(dots.every((dot) => dot.opacity >= 0.12 && dot.opacity <= 1)).toBe(true);
    }
  });
});
