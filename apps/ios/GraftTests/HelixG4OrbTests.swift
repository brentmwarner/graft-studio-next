import Testing
@testable import Graft

struct HelixG4OrbTests {
    @Test func globeHasFiveRingsOfEightDots() {
        let dots = HelixG4Renderer.dots(progress: 0)
        #expect(dots.count == 40)
        #expect(HelixG4Renderer.latitudes.count == 5)
        #expect(HelixG4Renderer.dotsPerRing == 8)
        #expect(HelixG4Renderer.poseCount == 31)
        #expect(HelixG4Renderer.keyframes.count == 41)
        #expect(HelixG4Renderer.cycle == 2.8)
    }

    @Test func evenRingsTurnNegativeOddRingsPositive() {
        #expect(HelixG4Renderer.ringDirection(0) == -1)
        #expect(HelixG4Renderer.ringDirection(1) == 1)
        #expect(HelixG4Renderer.ringDirection(2) == -1)
        #expect(HelixG4Renderer.ringDirection(3) == 1)
        #expect(HelixG4Renderer.ringDirection(4) == -1)
    }

    @Test func g4MoveSequenceMatchesAicss() {
        #expect(HelixG4Renderer.moveRings == [2, 1, 3, 0, 4, 2, 1, 3, 0, 4])
        #expect(HelixG4Renderer.activeRing(progress: 0) == 2)
        #expect(HelixG4Renderer.activeRing(progress: 0.05) == 2)
        #expect(HelixG4Renderer.activeRing(progress: 0.10) == 1)
        #expect(HelixG4Renderer.activeRing(progress: 0.20) == 3)
        #expect(HelixG4Renderer.activeRing(progress: 0.99) == 4)
    }

    @Test func restPoseMatchesAicssProjection() {
        let dots = HelixG4Renderer.dots(progress: 0)
        // Equator, longitude 0 — on the silhouette, so depth ink is low.
        assertNear(dots[dotIndex(ring: 2, spoke: 0)], x: 8.5, y: 0, z: 0, opacity: 0.134972)
        // Equator, 90° — toward the camera after the 14° tilt.
        assertNear(dots[dotIndex(ring: 2, spoke: 2)], x: 0, y: 2.056336, z: 8.247514, opacity: 0.955127)
        assertNear(dots[dotIndex(ring: 0, spoke: 0)], x: 5.233123, y: -6.499129, z: 1.620415, opacity: 0.197210)
        assertNear(dots[dotIndex(ring: 1, spoke: 0)], x: 7.639749, y: -3.615472, z: 0.901438, opacity: 0.163626)
        // Far southern ring is dimmer (behind the tilt).
        assertNear(dots[dotIndex(ring: 4, spoke: 0)], x: 5.233123, y: 6.499129, z: -1.620415, opacity: 0.12)
    }

    @Test func firstEquatorTurnFlipsTheLeadDot() {
        let mid = HelixG4Renderer.dots(progress: 0.05)
        assertNear(mid[dotIndex(ring: 2, spoke: 0)], x: -4.25, y: -1.780839, z: -7.142556, opacity: 0.12)
        // Neighboring rings hold still during the first move.
        let still = HelixG4Renderer.dots(progress: 0)
        assertNear(mid[dotIndex(ring: 1, spoke: 0)], still[dotIndex(ring: 1, spoke: 0)])
        assertNear(mid[dotIndex(ring: 0, spoke: 0)], still[dotIndex(ring: 0, spoke: 0)])

        let settled = HelixG4Renderer.dots(progress: 0.10)
        assertNear(settled[dotIndex(ring: 2, spoke: 0)], x: -8.5, y: 0, z: 0, opacity: 0.134972)
        assertNear(settled[dotIndex(ring: 1, spoke: 0)], still[dotIndex(ring: 1, spoke: 0)])
    }

    @Test func secondMoveTurnsTheNorthernMidRing() {
        let dots = HelixG4Renderer.dots(progress: 0.20)
        assertNear(dots[dotIndex(ring: 1, spoke: 0)], x: -7.639749, y: -3.615472, z: 0.901438, opacity: 0.163626)
    }

    @Test func frontDotsAreBrighterThanBackDots() {
        let dots = HelixG4Renderer.dots(progress: 0)
        let front = dots.max(by: { $0.z < $1.z })
        let back = dots.min(by: { $0.z < $1.z })
        #expect(front != nil && back != nil)
        #expect((front?.opacity ?? 0) > (back?.opacity ?? 1))
    }

    @Test func progressOneWrapsToTheRestPose() {
        let rest = HelixG4Renderer.dots(progress: 0)
        let wrapped = HelixG4Renderer.dots(progress: 1)
        for (a, b) in zip(rest, wrapped) {
            assertNear(a, b)
        }
    }
}

private func dotIndex(ring: Int, spoke: Int) -> Int {
    ring * HelixG4Renderer.dotsPerRing + spoke
}

private func assertNear(_ dot: HelixG4Dot, x: Double, y: Double, z: Double, opacity: Double) {
    assertNear(dot, HelixG4Dot(x: x, y: y, z: z, opacity: opacity))
}

private func assertNear(_ lhs: HelixG4Dot, _ rhs: HelixG4Dot) {
    #expect(abs(lhs.x - rhs.x) < 1e-5)
    #expect(abs(lhs.y - rhs.y) < 1e-5)
    #expect(abs(lhs.z - rhs.z) < 1e-5)
    #expect(abs(lhs.opacity - rhs.opacity) < 1e-5)
}
