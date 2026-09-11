import SwiftUI

// Native SwiftUI port of the `thinking-orbs` working state's detailed 64 px
// preset, scaled into Fetch's compact 28 pt loader footprint.
// Source: https://github.com/Jakubantalik/thinking-orbs
// Audited against source commit eda2d708b99ab871993bbea5a5f08d23a14da436.
//
// MIT License
//
// Copyright (c) 2026 Jakub Antalik
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/// The detailed `thinking-orbs` working state: particles moving along tilted
/// ghost paths, with depth expressed through dot size and ink weight.
struct WorkingOrbLoader: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    private let size: CGFloat

    init(size: CGFloat = 28) {
        self.size = size
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { timeline in
            let time = reduceMotion
                ? WorkingOrbRenderer.reducedMotionTime
                : timeline.date.timeIntervalSinceReferenceDate * WorkingOrbRenderer.speed

            Canvas { context, size in
                let displayScale = size.width / WorkingOrbRenderer.referenceSize
                context.scaleBy(x: displayScale, y: displayScale)
                WorkingOrbRenderer.draw(
                    in: context,
                    time: time,
                    dark: colorScheme == .dark
                )
            }
        }
        .frame(
            width: size,
            height: size
        )
        .accessibilityHidden(true)
    }
}

struct WorkingOrbDot {
    let x: Double
    let y: Double
    let z: Double
    let radius: Double
    let white: Double
    let opacity: Double
    let insertionOrder: Int
}

enum WorkingOrbRenderer {
    // Exact values from the library's working/64 preset.
    static let referenceSize = 64.0
    static let displaySize = 28.0
    static let speed = 1.885
    static let reducedMotionTime = 0.6

    private static let orbitCount = 12
    private static let ghostCount = 40
    private static let particlesPerOrbit = 3
    private static let ghostRadius = 0.9
    private static let ghostOpacity = 0.5
    private static let particleRadius = 1.2
    private static let particleDepthRadius = 1.6
    private static let radiusPower = 0.6
    private static let minimumRadius = 0.3

    static func draw(in context: GraphicsContext, time: Double, dark: Bool) {
        for dot in dots(time: time) {
            let ink = min(1, max(0, dot.white))
            let gray = (dark ? 1 - ink : ink) * 255
            let channel = gray.rounded() / 255
            let color = Color(
                .sRGB,
                red: channel,
                green: channel,
                blue: channel,
                opacity: dot.opacity
            )
            let radius = max(minimumRadius, dot.radius)
            let rect = CGRect(
                x: dot.x - radius,
                y: dot.y - radius,
                width: radius * 2,
                height: radius * 2
            )
            context.fill(Path(ellipseIn: rect), with: .color(color))
        }
    }

    /// Exact port of the library's `drawOrbits` renderer after resolving the
    /// working/64 preset against its base profile.
    static func dots(time: Double) -> [WorkingOrbDot] {
        let center = referenceSize / 2
        let sphereRadius = center * 0.82
        let project = projector(
            yaw: time * 0.12,
            tilt: 0.3,
            centerX: center,
            centerY: center
        )
        let dotScale = pow(referenceSize / 300, radiusPower)

        var dots: [WorkingOrbDot] = []
        dots.reserveCapacity(orbitCount * (ghostCount + particlesPerOrbit))

        for orbit in 0..<orbitCount {
            let h1 = deterministicHash(Double(orbit), 1.7)
            let h2 = deterministicHash(Double(orbit), 5.2)
            let h3 = deterministicHash(Double(orbit), 8.9)
            let orbitRadius = sphereRadius * (0.45 + 0.52 * h1)
            let theta = h1 * 2 * .pi
            let phi = acos(2 * h2 - 1)
            let normalX = sin(phi) * cos(theta)
            let normalY = cos(phi)
            let normalZ = sin(phi) * sin(theta)
            var basisUX = -normalY
            var basisUY = normalX
            let basisUZ = 0.0
            let basisLength = max(1e-6, sqrt(basisUX * basisUX + basisUY * basisUY))
            basisUX /= basisLength
            basisUY /= basisLength
            let basisVX = normalY * basisUZ - normalZ * basisUY
            let basisVY = normalZ * basisUX - normalX * basisUZ
            let basisVZ = normalX * basisUY - normalY * basisUX
            let direction = h3 > 0.5 ? 1.0 : -1.0
            let particleSpeed = (0.25 + 0.55 * h3) * direction

            for ghost in 0..<ghostCount {
                let angle = Double(ghost) / Double(ghostCount) * 2 * .pi
                let point = project(
                    (basisUX * cos(angle) + basisVX * sin(angle)) * orbitRadius,
                    (basisUY * cos(angle) + basisVY * sin(angle)) * orbitRadius,
                    (basisUZ * cos(angle) + basisVZ * sin(angle)) * orbitRadius
                )
                let depth = (point.z / orbitRadius + 1) / 2
                dots.append(
                    WorkingOrbDot(
                        x: point.x,
                        y: point.y,
                        z: point.z,
                        radius: ghostRadius * dotScale,
                        white: 0.72,
                        opacity: ghostOpacity * (0.4 + 0.6 * depth),
                        insertionOrder: dots.count
                    )
                )
            }

            for particle in 0..<particlesPerOrbit {
                let angle = time * particleSpeed
                    + Double(particle) / Double(particlesPerOrbit) * 2 * .pi
                    + h2 * 6
                let point = project(
                    (basisUX * cos(angle) + basisVX * sin(angle)) * orbitRadius,
                    (basisUY * cos(angle) + basisVY * sin(angle)) * orbitRadius,
                    (basisUZ * cos(angle) + basisVZ * sin(angle)) * orbitRadius
                )
                let depth = (point.z / orbitRadius + 1) / 2
                dots.append(
                    WorkingOrbDot(
                        x: point.x,
                        y: point.y,
                        z: point.z,
                        radius: (particleRadius + particleDepthRadius * depth) * dotScale,
                        white: 0.3 - 0.22 * depth,
                        opacity: 1,
                        insertionOrder: dots.count
                    )
                )
            }
        }

        return dots.sorted {
            $0.z == $1.z
                ? $0.insertionOrder < $1.insertionOrder
                : $0.z < $1.z
        }
    }

    private static func deterministicHash(_ first: Double, _ second: Double) -> Double {
        let value = sin(first * 12.9898 + second * 78.233) * 43_758.5453
        return value - floor(value)
    }

    private static func projector(
        yaw: Double,
        tilt: Double,
        centerX: Double,
        centerY: Double
    ) -> (Double, Double, Double) -> (x: Double, y: Double, z: Double) {
        let sinTilt = sin(tilt)
        let cosTilt = cos(tilt)
        let sinYaw = sin(yaw)
        let cosYaw = cos(yaw)

        return { x, y, z in
            let rotatedX = x * cosYaw + z * sinYaw
            let rotatedZ = -x * sinYaw + z * cosYaw
            let rotatedY = y * cosTilt - rotatedZ * sinTilt
            let depth = y * sinTilt + rotatedZ * cosTilt
            return (centerX + rotatedX, centerY - rotatedY, depth)
        }
    }
}

#if DEBUG
#Preview("Working orb") {
    HStack(spacing: 24) {
        WorkingOrbLoader()
            .padding(12)
            .background(.white)
            .environment(\.colorScheme, .light)
        WorkingOrbLoader()
            .padding(12)
            .background(.black)
            .environment(\.colorScheme, .dark)
    }
    .padding()
}
#endif
