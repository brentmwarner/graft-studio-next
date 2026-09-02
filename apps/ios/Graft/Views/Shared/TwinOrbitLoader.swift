import SwiftUI

/// Twin Orbit — a 5×5 dot-matrix loader ported from the "dot/matrix" library
/// (loader `dotm-square-4`). A bright head with a fading tail snakes *clockwise*
/// around the outer 16-dot ring while a second snake runs *anticlockwise* around
/// the inner 8-dot ring; the center dot stays dark. Used in place of the ⋯ glyph
/// on the working live-status header.
///
/// Drawn in a single `Canvas` driven by `TimelineView(.animation)` rather than a
/// `repeatForever` animation: the transcript re-renders on every streamed token,
/// which would keep cancelling an implicit animation mid-loop — a timeline keeps
/// its own clock and stays smooth. For Reduce Motion it freezes into the
/// library's static brightness ring.
struct TwinOrbitLoader: View {
    /// Side length of the square matrix, in points.
    var size: CGFloat = 16
    /// Seconds for one full revolution (library default is 1.5s at speed 1).
    var cycle: Double = 1.5
    /// Dot colour; the keyframe's base/peak opacities ride on top of it, so a
    /// full-strength colour (the default) gives the quiet→bright head the
    /// library intends from `currentColor`.
    var tint: Color = .primary

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            let progress = reduceMotion
                ? 0
                : context.date.timeIntervalSinceReferenceDate
                    .truncatingRemainder(dividingBy: cycle) / cycle
            Canvas { ctx, _ in
                let dot = size * 0.125            // 3pt dot at the library's 24pt size
                let gap = (size - dot * 5) / 4
                let unit = dot + gap
                for index in 0..<25 {
                    let opacity = Self.opacity(index: index, progress: progress, reduced: reduceMotion)
                    guard opacity > 0.001 else { continue }
                    let x = dot / 2 + CGFloat(index % 5) * unit
                    let y = dot / 2 + CGFloat(index / 5) * unit
                    let rect = CGRect(x: x - dot / 2, y: y - dot / 2, width: dot, height: dot)
                    ctx.fill(Path(ellipseIn: rect), with: .color(tint.opacity(opacity)))
                }
            }
            .frame(width: size, height: size)
        }
        .accessibilityHidden(true)
    }

    // MARK: Ring geometry (verbatim from the library's grid-paths.ts)

    /// `row*5 + col` → clockwise position 0…15 on the outer ring, −1 if off it.
    private static let outerOrder = ringMap([
        (0, 0), (0, 1), (0, 2), (0, 3), (0, 4), (1, 4), (2, 4), (3, 4),
        (4, 4), (4, 3), (4, 2), (4, 1), (4, 0), (3, 0), (2, 0), (1, 0),
    ])
    /// `row*5 + col` → anticlockwise position 0…7 on the inner ring, −1 if off it.
    private static let middleOrder = ringMap([
        (1, 1), (2, 1), (3, 1), (3, 2), (3, 3), (2, 3), (1, 3), (1, 2),
    ])

    private static func ringMap(_ coords: [(Int, Int)]) -> [Int] {
        var map = [Int](repeating: -1, count: 25)
        for (order, c) in coords.enumerated() { map[c.0 * 5 + c.1] = order }
        return map
    }

    /// Opacity for one cell at global `progress` ∈ [0,1). Every non-center cell
    /// belongs to exactly one ring; the center (2,2) returns 0.
    private static func opacity(index: Int, progress: Double, reduced: Bool) -> Double {
        if outerOrder[index] >= 0 {
            let order = outerOrder[index]
            return reduced
                ? 0.2 + (Double(order) / 15) * 0.72
                : ringSnake(phase: progress - Double(order) / 16)
        }
        if middleOrder[index] >= 0 {
            let order = middleOrder[index]
            return reduced
                ? 0.2 + (Double(order) / 7) * 0.72
                : ringSnake(phase: progress - Double(order) / 8)
        }
        return 0
    }

    /// The `dmx-ring-snake` keyframe — a fast spike to full brightness then a
    /// graded tail — resolved with base 0.16 / mid 0.32 / peak 1.0.
    private static let snakeStops: [(phase: Double, opacity: Double)] = [
        (0.0, 0.08),    // 0.5 · base
        (0.1, 1.0),     // peak
        (0.2, 0.61),    // .45 peak + .45 mid + .1 base
        (0.3, 0.392),   // .2 peak + .4 mid + .4 base
        (0.4, 0.14),    // 0.875 · base
        (1.0, 0.08),
    ]

    private static func ringSnake(phase rawPhase: Double) -> Double {
        var phase = rawPhase.truncatingRemainder(dividingBy: 1)
        if phase < 0 { phase += 1 }
        for i in 1..<snakeStops.count where phase <= snakeStops[i].phase {
            let lo = snakeStops[i - 1], hi = snakeStops[i]
            let fraction = (phase - lo.phase) / (hi.phase - lo.phase)
            return lo.opacity + (hi.opacity - lo.opacity) * fraction
        }
        return 0.08
    }
}

#if DEBUG
#Preview("Twin Orbit") {
    HStack(spacing: 24) {
        TwinOrbitLoader(size: 16)
        TwinOrbitLoader(size: 28)
        TwinOrbitLoader(size: 48)
    }
    .padding()
}
#endif

/// The branded 5×5 liveness mark used by Graft desktop's `DotmSquare20`.
/// Two heads travel around the perimeter with asymmetric tails, while the
/// inside corner and center briefly pulse at each fold in the path.
struct RunStatusDotMatrixLoader: View {
    var size: CGFloat = 18
    var tint: Color = .primary

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { context in
            let step = reduceMotion
                ? 0
                : Int(
                    floor(
                        context.date.timeIntervalSinceReferenceDate * 1_000
                            / Self.stepMilliseconds
                    )
                ) % Self.perimeter.count
            Canvas { drawingContext, _ in
                let dot = size * (2 / 14)
                let gap = (size - dot * 5) / 4
                let unit = dot + gap
                for index in 0..<25 {
                    let opacity = Self.opacity(
                        index: index,
                        headStep: step,
                        reduced: reduceMotion
                    )
                    let x = dot / 2 + CGFloat(index % 5) * unit
                    let y = dot / 2 + CGFloat(index / 5) * unit
                    let rect = CGRect(
                        x: x - dot / 2,
                        y: y - dot / 2,
                        width: dot,
                        height: dot
                    )
                    drawingContext.fill(
                        Path(ellipseIn: rect),
                        with: .color(tint.opacity(opacity))
                    )
                }
            }
            .frame(width: size, height: size)
        }
        .accessibilityHidden(true)
    }

    private static let speed = 1.45
    private static let cycleMilliseconds = 1_600 / speed
    private static let perimeter = [
        0, 1, 2, 3, 4, 9, 14, 19, 24, 23, 22, 21, 20, 15, 10, 5,
    ]
    private static let stepMilliseconds = cycleMilliseconds / Double(perimeter.count)
    private static let brightTail = [1.0, 0.82, 0.64, 0.46, 0.3, 0.18]
    private static let backTail = [0.38, 0.3, 0.22, 0.14]
    private static let twistInner = [0: 6, 4: 8, 8: 18, 12: 16]

    private static func tailOpacity(distance: Int, tail: [Double]) -> Double {
        guard distance >= 0, distance < tail.count else { return 0 }
        return tail[distance]
    }

    private static func opacity(index: Int, headStep: Int, reduced: Bool) -> Double {
        let loopStep = perimeter.firstIndex(of: index)
        if reduced {
            if loopStep != nil { return 0.48 }
            return index == 12 ? 0.22 : 0.08
        }

        var value = 0.08
        if let loopStep {
            let backHead = (headStep + perimeter.count / 2) % perimeter.count
            let forward = (headStep - loopStep + perimeter.count) % perimeter.count
            let backward = (backHead - loopStep + perimeter.count) % perimeter.count
            value = max(
                value,
                tailOpacity(distance: forward, tail: brightTail),
                tailOpacity(distance: backward, tail: backTail)
            )
        }
        if twistInner[headStep] == index {
            value = max(value, 0.52)
        }
        if index == 12, headStep % 4 == 0 {
            value = max(value, 0.55)
        }
        return min(1, value)
    }
}

#if DEBUG
#Preview("Run status dot matrix") {
    HStack(spacing: 24) {
        RunStatusDotMatrixLoader()
        RunStatusDotMatrixLoader(size: 28)
    }
    .padding()
}
#endif

/// Sweep Arc — a three-quarter ring whose stroke fades from transparent at the
/// tail to full strength at the head, spun continuously. Used as the menu's
/// "agent is working" indicator: a quiet, faded circular spinner rather than
/// the system activity dial. Driven by `TimelineView(.animation)` so list
/// re-renders can't cancel it mid-spin; freezes to a static arc under Reduce
/// Motion.
struct SweepArcLoader: View {
    /// Diameter in points.
    var size: CGFloat = 16
    var lineWidth: CGFloat = 2
    /// Seconds per revolution.
    var cycle: Double = 0.8
    /// Fraction of the ring that is drawn — the rest is the open gap.
    var sweep: CGFloat = 0.72
    var tint: Color = .primary

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            let progress = reduceMotion
                ? 0
                : context.date.timeIntervalSinceReferenceDate
                    .truncatingRemainder(dividingBy: cycle) / cycle
            Circle()
                .trim(from: 0, to: sweep)
                .stroke(
                    AngularGradient(
                        gradient: Gradient(stops: [
                            .init(color: tint.opacity(0), location: 0),
                            .init(color: tint.opacity(0.95), location: sweep),
                            .init(color: tint.opacity(0), location: 1),
                        ]),
                        center: .center
                    ),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(progress * 360))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

#if DEBUG
#Preview("Sweep Arc") {
    HStack(spacing: 24) {
        SweepArcLoader(size: 15)
        SweepArcLoader(size: 28)
        SweepArcLoader(size: 48, lineWidth: 3)
    }
    .padding()
}
#endif
