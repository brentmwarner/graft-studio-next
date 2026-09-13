import SwiftUI

/// AICSS Orbs **G4** — Helix / globe “Syncing”.
///
/// Native SwiftUI port of the G4 `HelixVariant` from
/// https://www.aicss.dev/components/orbs
/// (registry: https://www.aicss.dev/r/orbs.json).
///
/// Geometry is authored on a 28 px stage and scaled with `size / 28`. A globe
/// of five latitude rings × eight dots turns one ring at a time (±π, even
/// rings −1 / odd +1) along the G4 sequence `[2, 1, 3, 0, 4, 2, 1, 3, 0, 4]`.
/// Depth is ink opacity — front brighter — matching `orb-globe-ringturn`
/// (2.8 s linear infinite). Android’s live-status header is aligning to this
/// same variant.
///
/// Used as Graft iOS’s thinking / composing activity indicator. Reduce Motion
/// freezes the rest pose (progress 0) instead of collapsing the dots.
struct ComposingOrbLoader: View {
    /// Rendered edge length. AICSS default indicator is ~20×20.
    var size: CGFloat = HelixG4Renderer.defaultSize
    /// Foreground ink; per-dot opacity carries depth. Follows light/dark
    /// like the rest of Graft (`currentColor` in the CSS source).
    var tint: Color = .primary
    /// Standalone accessible name. Live-status call sites hide this glyph
    /// because the phrase already labels the row.
    var label: String = "Thinking"

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { timeline in
            let progress = reduceMotion
                ? 0
                : timeline.date.timeIntervalSinceReferenceDate
                    .truncatingRemainder(dividingBy: HelixG4Renderer.cycle)
                    / HelixG4Renderer.cycle
            Canvas { context, canvasSize in
                HelixG4Renderer.draw(
                    in: context,
                    canvasSize: canvasSize,
                    progress: progress,
                    tint: tint
                )
            }
        }
        .frame(width: size, height: size)
        .accessibilityElement()
        .accessibilityLabel(label)
    }
}

struct HelixG4Dot: Equatable {
    var x: Double
    var y: Double
    var z: Double
    var opacity: Double
}

/// Discrete G4 globe: 5 × 8 dots, sequential latitude-ring turns, depth
/// opacity. Screen Y is the CSS `--gky` value (`-projectedY`).
enum HelixG4Renderer {
    static let stage = 28.0
    static let defaultSize: CGFloat = 20
    static let cycle = 2.8
    static let dotDiameter = 2.0
    static let globeRadius = 8.5
    static let tilt = 14.0 * Double.pi / 180
    static let dotsPerRing = 8
    static let latitudes = [52.0, 26.0, 0.0, -26.0, -52.0]
    static let moveRings = [2, 1, 3, 0, 4, 2, 1, 3, 0, 4]
    static let arcSteps = 3
    static let poseCount = 1 + moveRings.count * arcSteps

    private static let tiltCos = cos(tilt)
    private static let tiltSin = sin(tilt)

    /// CSS `orb-globe-ringturn` samples — 31 poses plus a 2.5 % hold after
    /// each 7.5 % turn, 10 moves × 10 % = 100 %.
    static let keyframes: [(time: Double, pose: Int)] = {
        var frames: [(Double, Int)] = [(0, 0)]
        for pose in 1...30 {
            let move = (pose - 1) / arcSteps
            let step = (pose - 1) % arcSteps
            frames.append((Double(move) * 0.10 + Double(step + 1) * 0.025, pose))
            if step == arcSteps - 1 {
                frames.append((Double(move) * 0.10 + 0.10, pose))
            }
        }
        return frames
    }()

    static func ringDirection(_ ring: Int) -> Double {
        ring.isMultiple(of: 2) ? -1 : 1
    }

    static func draw(
        in context: GraphicsContext,
        canvasSize: CGSize,
        progress: Double,
        tint: Color
    ) {
        let scale = Double(canvasSize.width) / stage
        let centerX = Double(canvasSize.width) / 2
        let centerY = Double(canvasSize.height) / 2
        let radius = max(0.35, dotDiameter * scale / 2)
        for dot in dots(progress: progress).sorted(by: { $0.z < $1.z }) {
            let rect = CGRect(
                x: centerX + dot.x * scale - radius,
                y: centerY + dot.y * scale - radius,
                width: radius * 2,
                height: radius * 2
            )
            context.fill(Path(ellipseIn: rect), with: .color(tint.opacity(dot.opacity)))
        }
    }

    static func dots(progress: Double) -> [HelixG4Dot] {
        var wrapped = progress.truncatingRemainder(dividingBy: 1)
        if wrapped < 0 { wrapped += 1 }
        let (from, to, fraction) = keyframeSpan(at: wrapped)
        var dots: [HelixG4Dot] = []
        dots.reserveCapacity(latitudes.count * dotsPerRing)
        for ring in latitudes.indices {
            for spoke in 0..<dotsPerRing {
                let poses = projectedPoses[ring][spoke]
                let a = poses[from]
                let b = poses[to]
                dots.append(
                    HelixG4Dot(
                        x: a.x + (b.x - a.x) * fraction,
                        y: a.y + (b.y - a.y) * fraction,
                        z: a.z + (b.z - a.z) * fraction,
                        opacity: a.opacity + (b.opacity - a.opacity) * fraction
                    )
                )
            }
        }
        return dots
    }

    /// Which latitude ring the G4 sequence is turning (or holding) at `progress`.
    static func activeRing(progress: Double) -> Int {
        var wrapped = progress.truncatingRemainder(dividingBy: 1)
        if wrapped < 0 { wrapped += 1 }
        let move = min(moveRings.count - 1, Int(wrapped / 0.10))
        return moveRings[move]
    }

    private static func keyframeSpan(at progress: Double) -> (Int, Int, Double) {
        let frames = keyframes
        var index = 0
        while index + 1 < frames.count, frames[index + 1].time <= progress {
            index += 1
        }
        let start = frames[index]
        guard index + 1 < frames.count else {
            return (start.pose, 0, 0)
        }
        let end = frames[index + 1]
        let span = end.time - start.time
        let fraction = span <= 1e-12 ? 0 : (progress - start.time) / span
        return (start.pose, end.pose, fraction)
    }

    private static let projectedPoses: [[[HelixG4Dot]]] = latitudes.indices.map { ring in
        (0..<dotsPerRing).map { spoke in
            ringTurnPoses(ring: ring, spoke: spoke).map(project)
        }
    }

    private static func restPoint(ring: Int, spoke: Int) -> (x: Double, y: Double, z: Double) {
        let lat = latitudes[ring] * Double.pi / 180
        let y = sin(lat) * globeRadius
        let ringRadius = cos(lat) * globeRadius
        let lon = Double(spoke) / Double(dotsPerRing) * Double.pi * 2
        return (cos(lon) * ringRadius, y, sin(lon) * ringRadius)
    }

    private static func ringTurnPoses(
        ring: Int,
        spoke: Int
    ) -> [(x: Double, y: Double, z: Double)] {
        var point = restPoint(ring: ring, spoke: spoke)
        var poses = [point]
        for moveRing in moveRings {
            let start = point
            let angle = ringDirection(moveRing) * Double.pi
            for step in 1...arcSteps {
                if ring == moveRing {
                    let a = angle * Double(step) / Double(arcSteps)
                    point = (
                        start.x * cos(a) - start.z * sin(a),
                        start.y,
                        start.x * sin(a) + start.z * cos(a)
                    )
                }
                poses.append(point)
            }
        }
        return poses
    }

    private static func project(_ point: (x: Double, y: Double, z: Double)) -> HelixG4Dot {
        let rotatedY = point.y * tiltCos - point.z * tiltSin
        let rotatedZ = point.y * tiltSin + point.z * tiltCos
        return HelixG4Dot(
            x: point.x,
            y: -rotatedY,
            z: rotatedZ,
            opacity: globeOpacity(rotatedZ)
        )
    }

    private static func globeOpacity(_ z: Double) -> Double {
        let t = min(1, max(0, (z / globeRadius + 0.15) / 1.15))
        return 0.12 + 0.88 * t * t
    }
}

#if DEBUG
#Preview("G4 composing orb") {
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
