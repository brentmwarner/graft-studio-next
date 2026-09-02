import SwiftUI

// Native SwiftUI port of the `thinking-orbs` composing state's detailed 64 px
// preset, scaled into Fetch's compact 28 pt turn-loader footprint.
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

/// The detailed `thinking-orbs` composing state used by the live demo.
///
/// The original renders depth-sorted circle fills on a 2D canvas. SwiftUI's
/// `Canvas` preserves that drawing model and GPU acceleration without changing
/// the source animation's antialiasing or alpha-compositing behavior. A shared
/// absolute clock keeps every visible turn loader in phase, just like the web
/// component's `performance.now()` clock.
struct ComposingOrbLoader: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    private let size: CGFloat

    init(size: CGFloat = 28) {
        self.size = size
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { timeline in
            let time = reduceMotion
                ? ComposingOrbRenderer.reducedMotionTime
                : timeline.date.timeIntervalSinceReferenceDate * ComposingOrbRenderer.speed

            Canvas { context, size in
                let displayScale = size.width / ComposingOrbRenderer.referenceSize
                context.scaleBy(x: displayScale, y: displayScale)
                ComposingOrbRenderer.draw(
                    in: context,
                    size: CGSize(
                        width: ComposingOrbRenderer.referenceSize,
                        height: ComposingOrbRenderer.referenceSize
                    ),
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

struct ComposingOrbDot {
    let x: Double
    let y: Double
    let z: Double
    let radius: Double
    let white: Double
    let opacity: Double
    let insertionOrder: Int
}

enum ComposingOrbRenderer {
    // Exact values from the library's composing/64 preset.
    static let referenceSize = 64.0
    static let speed = 2.34
    static let reducedMotionTime = 0.6

    static let displaySize = 28.0

    private static let countScale = 0.25
    private static let radiusScaleMultiplier = 0.85
    private static let bandMultiplier = 3.9
    private static let baseLanes = 5
    private static let baseSegments = 88
    private static let baseGhostCount = 150
    private static let baseRadius = 1.1
    private static let depthRadius = 1.7
    private static let radiusPower = 0.6
    private static let minimumRadius = 0.3
    private static let spin = 0.0

    static func draw(in context: GraphicsContext, size: CGSize, time: Double, dark: Bool) {
        for dot in dots(size: Double(size.width), time: time) {
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

    /// Port of `drawRibbon`, including the library's count/radius preset
    /// resolution. Keeping this deterministic makes pixel comparison against
    /// the web canvas possible at any source time.
    static func dots(size: Double = referenceSize, time: Double) -> [ComposingOrbDot] {
        let center = size / 2
        let sphereRadius = center * 0.78
        let project = projector(
            yaw: time * 0.1 * spin,
            tilt: 0.3,
            centerX: center,
            centerY: center
        )
        let dotScale = pow(size / 300, radiusPower)
        let resolvedGhostCount = max(1, Int((Double(baseGhostCount) * countScale).rounded()))
        let resolvedBaseLanes = max(2, Int((Double(baseLanes) * sqrt(countScale)).rounded()))
        let resolvedSegments = max(2, Int((Double(baseSegments) * sqrt(countScale)).rounded()))
        let laneCount = max(1, Int((Double(resolvedBaseLanes) * bandMultiplier).rounded()))
        let resolvedBaseRadius = baseRadius * radiusScaleMultiplier
        let resolvedDepthRadius = depthRadius * radiusScaleMultiplier

        var dots: [ComposingOrbDot] = []
        dots.reserveCapacity(resolvedGhostCount + laneCount * resolvedSegments)

        for index in 0..<resolvedGhostCount {
            let direction = fibonacciDirection(index: index, count: resolvedGhostCount)
            let point = project(
                direction.x * sphereRadius,
                direction.y * sphereRadius,
                direction.z * sphereRadius
            )
            let depth = (point.z / sphereRadius + 1) / 2
            dots.append(
                ComposingOrbDot(
                    x: point.x,
                    y: point.y,
                    z: point.z,
                    radius: 0.8 * dotScale,
                    white: 0.78,
                    opacity: 0.1 + 0.22 * depth,
                    insertionOrder: dots.count
                )
            )
        }

        let yaw = time * 0.24 * spin
        let tilt = 0.55 + 0.3 * sin(time * 0.18) * spin
        let ux = cos(yaw)
        let uy = 0.0
        let uz = sin(yaw)
        let vx = -uz * sin(tilt)
        let vy = cos(tilt)
        let vz = ux * sin(tilt)
        let nx = uy * vz - uz * vy
        let ny = uz * vx - ux * vz
        let nz = ux * vy - uy * vx

        for lane in 0..<laneCount {
            let laneOffset = (Double(lane) - Double(laneCount - 1) / 2) * 0.075
            let edge = abs(Double(lane) - Double(laneCount - 1) / 2)
                / max(1, Double(laneCount - 1) / 2)

            for segment in 0..<resolvedSegments {
                let angle = Double(segment) / Double(resolvedSegments) * 2 * .pi
                let wobble = 0.16 * sin(angle * 3 - time * 1.7 + Double(lane) * 0.22)
                    + 0.07 * sin(angle * 5 + time * 1.1)
                let offset = laneOffset + wobble
                let x = ux * cos(angle) + vx * sin(angle) + nx * offset
                let y = uy * cos(angle) + vy * sin(angle) + ny * offset
                let z = uz * cos(angle) + vz * sin(angle) + nz * offset
                let length = sqrt(x * x + y * y + z * z)
                let point = project(
                    x / length * sphereRadius,
                    y / length * sphereRadius,
                    z / length * sphereRadius
                )
                let depth = (point.z / sphereRadius + 1) / 2

                dots.append(
                    ComposingOrbDot(
                        x: point.x,
                        y: point.y,
                        z: point.z,
                        radius: (resolvedBaseRadius + resolvedDepthRadius * depth)
                            * (1 - 0.25 * edge) * dotScale,
                        white: 0.52 - 0.44 * depth + 0.18 * edge,
                        opacity: 0.4 + 0.6 * depth,
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

    private static func fibonacciDirection(index: Int, count: Int) -> (x: Double, y: Double, z: Double) {
        let goldenAngle = Double.pi * (3 - sqrt(5))
        let y = 1 - 2 * (Double(index) + 0.5) / Double(count)
        let radial = sqrt(1 - y * y)
        let angle = Double(index) * goldenAngle
        return (radial * cos(angle), y, radial * sin(angle))
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
#Preview("Composing orb") {
    HStack(spacing: 24) {
        ComposingOrbLoader()
            .padding(12)
            .background(.white)
            .environment(\.colorScheme, .light)
        ComposingOrbLoader()
            .padding(12)
            .background(.black)
            .environment(\.colorScheme, .dark)
    }
    .padding()
}
#endif
