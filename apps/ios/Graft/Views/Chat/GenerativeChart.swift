//
//  GenerativeChart.swift
//  Fetch — native chart bodies for generative-UI cards
//
//  A `card` fence may carry a `chart` object; `GenerativeCardView` renders it
//  in the card body via `GenerativeChartView`. Everything here is pure
//  monochrome (DS ink only — "direction by opacity, not red/green"), so the
//  charts read as typeset data, not a dashboard. The visual language was tuned
//  in the web studio: explorations/gen-ui-charts/index.html
//
//  Each chart owns a restrained entrance (bars rise from the baseline, the line
//  draws on, the meter sweeps in), staggered and Reduce-Motion safe.
//

import SwiftUI

// MARK: - Spec

/// The `chart` payload on a `CardSpec`. Flat and all-optional like `CardSpec`
/// itself — the LLM fills only the fields a given `type` needs. Unknown types
/// resolve to `nil` and render nothing (the card still shows its title/stats).
struct ChartSpec: Decodable, Equatable {
    /// Discriminator: bars · line · diverging · meter · groupedBars ·
    /// horizontalBars · heatmap (aliases tolerated, see `kind`).
    var type: String?

    /// Primary series. Bars/line/horizontalBars/diverging read this; heatmap
    /// reads it row-major as 0…1 intensities.
    var values: [Double]?
    /// Multiple series for `groupedBars` (and reserved for multi-line).
    var series: [[Double]]?
    /// Axis / category labels. May match `values` count (sampled for display)
    /// or be fewer (distributed evenly across the axis).
    var labels: [String]?
    /// Series / segment names — the legend row (first is solid ink, rest faint).
    var legend: [String]?

    /// Index of the called-out element (solid ink) for bars/line/horizontalBars.
    var highlight: Int?
    /// Text printed above the highlighted element (e.g. its value).
    var caption: String?

    /// `meter` fill, 0…100.
    var value: Double?
    /// `line`: fill the area under the curve / smooth the curve.
    var area: Bool?
    var smooth: Bool?

    /// `heatmap` grid shape + edge labels.
    var rows: Int?
    var columns: Int?
    var rowLabels: [String]?
    var columnLabels: [String]?

    enum Kind: Equatable {
        case bars, line, diverging, meter, groupedBars, horizontalBars, heatmap
    }

    /// Tolerant string → `Kind`. Returns `nil` for an unrecognized type so an
    /// otherwise-empty chart card degrades to a code block rather than rendering
    /// a blank body.
    var kind: Kind? {
        guard let type else { return nil }
        switch type.lowercased().filter({ $0.isLetter }) {
        case "bars", "bar", "column", "columns", "barchart": return .bars
        case "line", "area", "trend", "linechart", "spark", "sparkline": return .line
        case "diverging", "divergingbars", "delta", "change", "netchange": return .diverging
        case "meter", "progress", "gauge", "tickcomb", "comb": return .meter
        case "groupedbars", "grouped", "groups", "clustered": return .groupedBars
        case "horizontalbars", "hbars", "ranked", "ranking", "bartrack": return .horizontalBars
        case "heatmap", "heat", "grid", "calendar": return .heatmap
        default: return nil
        }
    }
}

// MARK: - Router

/// Renders a `ChartSpec` as the right native chart. Sized intrinsically so it
/// drops straight into the card's content `VStack`.
struct GenerativeChartView: View {
    let spec: ChartSpec

    var body: some View {
        switch spec.kind {
        case .bars:
            BarsChart(values: spec.values ?? [], labels: spec.labels,
                      highlight: spec.highlight, caption: spec.caption)
        case .line:
            LineChart(values: spec.values ?? [], labels: spec.labels,
                      highlight: spec.highlight, caption: spec.caption,
                      filled: spec.area ?? true, smooth: spec.smooth ?? true)
        case .diverging:
            DivergingChart(values: spec.values ?? [], labels: spec.labels)
        case .meter:
            MeterChart(percent: spec.value ?? 0, legend: spec.legend)
        case .groupedBars:
            GroupedBarsChart(series: spec.series ?? [], labels: spec.labels, legend: spec.legend)
        case .horizontalBars:
            HorizontalBarsChart(values: spec.values ?? [], labels: spec.labels ?? [],
                                highlight: spec.highlight)
        case .heatmap:
            HeatmapChart(values: spec.values ?? [], rows: spec.rows ?? 7,
                         columns: spec.columns ?? max(1, (spec.values?.count ?? 7) / max(1, spec.rows ?? 7)),
                         rowLabels: spec.rowLabels, columnLabels: spec.columnLabels)
        case .none:
            EmptyView()
        }
    }
}

// MARK: - Shared ink

/// The chart gradient family — strong at the free tip, dissolving into the
/// baseline. Built once on the adaptive `fg` token so it still resolves per
/// light/dark. Internal: UsagePage shares this ink so hub charts and gen-UI
/// chart cards speak one visual language.
enum ChartInk {
    /// Vertical bar: solid tip (top) → faint base (bottom). Gains + hero bars.
    static let barV = LinearGradient(
        colors: [DS.Color.fg.opacity(0.85), DS.Color.fg.opacity(0.10)],
        startPoint: .top, endPoint: .bottom)
    /// Reversed + muted — loss bars dissolve into the baseline (top), tip below.
    static let barVDim = LinearGradient(
        colors: [DS.Color.fg.opacity(0.05), DS.Color.fg.opacity(0.42)],
        startPoint: .top, endPoint: .bottom)
    /// Horizontal bar: solid at the root (leading) → faint at the tip.
    static let barH = LinearGradient(
        colors: [DS.Color.fg.opacity(0.85), DS.Color.fg.opacity(0.32)],
        startPoint: .leading, endPoint: .trailing)
    /// Area under a line — a soft wash fading to nothing.
    static let area = LinearGradient(
        colors: [DS.Color.fg.opacity(0.10), DS.Color.fg.opacity(0.0)],
        startPoint: .top, endPoint: .bottom)
}

// MARK: - Shared helpers

private func chartCenterX(_ i: Int, count n: Int, width: CGFloat) -> CGFloat {
    n > 0 ? (width / CGFloat(n)) * (CGFloat(i) + 0.5) : width / 2
}

private func chartFmt(_ v: Double) -> String {
    v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v)
}

private struct AxisTick: Identifiable { let id: Int; let text: String }

/// Resolve which axis labels to actually draw. Equal-count labels get sampled
/// down to ~6 evenly spaced ticks; a shorter list is spread across the axis.
/// De-duplicated by position so two ticks never collide on one bar.
private func axisTicks(_ labels: [String]?, count n: Int) -> [AxisTick] {
    guard let labels, !labels.isEmpty, n > 0 else { return [] }
    let m = labels.count
    var pairs: [(Int, String)] = []
    if m == n {
        if m <= 7 {
            pairs = labels.enumerated().map { ($0.offset, $0.element) }
        } else {
            let step = Double(m - 1) / 5.0
            pairs = (0...5).map { k in
                let i = Int((Double(k) * step).rounded())
                return (i, labels[i])
            }
        }
    } else if m == 1 {
        pairs = [(0, labels[0])]
    } else {
        pairs = labels.enumerated().map { j, t in
            (Int((Double(j) / Double(m - 1) * Double(n - 1)).rounded()), t)
        }
    }
    var seen = Set<Int>()
    return pairs.compactMap { idx, text in
        guard !seen.contains(idx) else { return nil }
        seen.insert(idx)
        return AxisTick(id: idx, text: text)
    }
}

/// The shared `● Paid  ○ Free` legend — first entry solid ink, the rest faint.
private struct ChartLegend: View {
    let names: [String]

    var body: some View {
        HStack(spacing: 18) {
            ForEach(Array(names.prefix(4).enumerated()), id: \.offset) { idx, name in
                HStack(spacing: 7) {
                    Circle()
                        .fill(idx == 0 ? DS.Color.fg : DS.Color.fgFaint)
                        .frame(width: 8, height: 8)
                    Text(name)
                        .font(DS.Font.footnote)
                        .foregroundStyle(DS.Color.fgSubtle)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

/// A positioned axis-label strip shared by the vertical-bar charts.
private struct AxisLabels: View {
    let ticks: [AxisTick]
    let count: Int

    var body: some View {
        GeometryReader { geo in
            ForEach(ticks) { tick in
                Text(tick.text)
                    .font(.system(size: 11))
                    .foregroundStyle(DS.Color.fgSubtle)
                    .lineLimit(1)
                    .fixedSize()
                    .position(x: chartCenterX(tick.id, count: count, width: geo.size.width),
                              y: geo.size.height / 2)
            }
        }
        .frame(height: 14)
    }
}

// MARK: - Bars (vertical gradient + optional highlight)

private struct BarsChart: View {
    let values: [Double]
    var labels: [String]?
    var highlight: Int?
    var caption: String?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var grow = false

    var body: some View {
        let ticks = axisTicks(labels, count: values.count)
        VStack(spacing: 6) {
            GeometryReader { geo in plot(in: geo.size) }
                .frame(height: 150)
            if !ticks.isEmpty { AxisLabels(ticks: ticks, count: values.count) }
        }
        .onAppear { grow = true }
    }

    private func plot(in size: CGSize) -> some View {
        let n = values.count
        let maxV = max(values.max() ?? 1, 0.0001)
        let usable = size.height - 18                 // headroom for the caption
        let slot = size.width / CGFloat(max(n, 1))
        let barW = min(slot * 0.66, 40)
        let stagger = n > 14 ? 0.018 : 0.045
        return ZStack(alignment: .topLeading) {
            ForEach(values.indices, id: \.self) { i in
                let h = max(2, CGFloat(values[i] / maxV) * usable)
                let cx = chartCenterX(i, count: n, width: size.width)
                let isHi = (i == highlight)
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(isHi ? AnyShapeStyle(DS.Color.fg) : AnyShapeStyle(ChartInk.barV))
                    .frame(width: barW, height: h)
                    .scaleEffect(x: 1, y: (grow || reduceMotion) ? 1 : 0.001, anchor: .bottom)
                    .opacity((grow || reduceMotion) ? 1 : 0)
                    .animation(reduceMotion ? nil : DS.Motion.appear.delay(Double(i) * stagger), value: grow)
                    .position(x: cx, y: size.height - h / 2)
                if isHi, let caption {
                    Text(caption)
                        .font(.system(size: 11, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(DS.Color.fg)
                        .fixedSize()
                        .opacity((grow || reduceMotion) ? 1 : 0)
                        .animation(reduceMotion ? nil : DS.Motion.appear.delay(Double(i) * stagger + 0.12), value: grow)
                        .position(x: cx, y: size.height - h - 9)
                }
            }
        }
    }
}

// MARK: - Horizontal bars (ranked)

private struct HorizontalBarsChart: View {
    let values: [Double]
    let labels: [String]
    var highlight: Int?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var grow = false

    var body: some View {
        let maxV = max(values.max() ?? 1, 0.0001)
        VStack(spacing: 8) {
            ForEach(values.indices, id: \.self) { i in
                row(i: i, frac: CGFloat(values[i] / maxV))
            }
        }
        .onAppear { grow = true }
    }

    private func row(i: Int, frac: CGFloat) -> some View {
        let isHi = (i == highlight)
        return HStack(spacing: 10) {
            Text(i < labels.count ? labels[i] : "")
                .font(.system(size: 12))
                .foregroundStyle(DS.Color.fgSubtle)
                .lineLimit(1)
                .frame(width: 64, alignment: .leading)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(DS.Color.bgSubtle)
                    Capsule()
                        .fill(isHi ? AnyShapeStyle(DS.Color.fg) : AnyShapeStyle(ChartInk.barH))
                        .frame(width: max(6, frac * geo.size.width))
                        .scaleEffect(x: (grow || reduceMotion) ? 1 : 0.001, anchor: .leading)
                        .opacity((grow || reduceMotion) ? 1 : 0)
                        .animation(reduceMotion ? nil : DS.Motion.appear.delay(Double(i) * 0.05), value: grow)
                }
            }
            .frame(height: 18)
            Text(chartFmt(values[i]))
                .font(.system(size: 12, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(DS.Color.fgMuted)
                .frame(width: 46, alignment: .trailing)
        }
    }
}

// MARK: - Diverging (gains full ink, losses faint)

private struct DivergingChart: View {
    let values: [Double]
    var labels: [String]?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var grow = false

    var body: some View {
        GeometryReader { geo in plot(in: geo.size) }
            .frame(height: 130)
            .onAppear { grow = true }
    }

    private func plot(in size: CGSize) -> some View {
        let n = values.count
        let maxAbs = max(values.map { abs($0) }.max() ?? 1, 0.0001)
        let mid = size.height / 2
        let half = mid - 10
        let slot = size.width / CGFloat(max(n, 1))
        let barW = min(slot * 0.6, 22)
        let stagger = n > 14 ? 0.016 : 0.04
        return ZStack(alignment: .topLeading) {
            Rectangle()
                .fill(DS.Color.border)
                .frame(height: 1)
                .position(x: size.width / 2, y: mid)
            ForEach(values.indices, id: \.self) { i in
                let v = values[i]
                let up = v >= 0
                let h = max(1, CGFloat(abs(v) / maxAbs) * half)
                RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                    .fill(up ? AnyShapeStyle(ChartInk.barV) : AnyShapeStyle(ChartInk.barVDim))
                    .frame(width: barW, height: h)
                    .scaleEffect(x: 1, y: (grow || reduceMotion) ? 1 : 0.001, anchor: up ? .bottom : .top)
                    .opacity((grow || reduceMotion) ? 1 : 0)
                    .animation(reduceMotion ? nil : DS.Motion.appear.delay(Double(i) * stagger), value: grow)
                    .position(x: chartCenterX(i, count: n, width: size.width),
                              y: up ? mid - h / 2 : mid + h / 2)
            }
        }
    }
}

// MARK: - Grouped bars (two series)

private struct GroupedBarsChart: View {
    let series: [[Double]]
    var labels: [String]?
    var legend: [String]?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var grow = false

    var body: some View {
        let groups = series.map(\.count).max() ?? 0
        let ticks = axisTicks(labels, count: groups)
        VStack(spacing: 8) {
            GeometryReader { geo in plot(in: geo.size, groups: groups) }
                .frame(height: 150)
            if !ticks.isEmpty { AxisLabels(ticks: ticks, count: groups) }
            if let legend, !legend.isEmpty { ChartLegend(names: legend) }
        }
        .onAppear { grow = true }
    }

    private func plot(in size: CGSize, groups: Int) -> some View {
        let sCount = max(series.count, 1)
        let maxV = max(series.flatMap { $0 }.max() ?? 1, 0.0001)
        let usable = size.height - 8
        let groupSlot = size.width / CGFloat(max(groups, 1))
        let barW = min(groupSlot / CGFloat(sCount) * 0.74, 18)
        return ZStack(alignment: .topLeading) {
            ForEach(0..<groups, id: \.self) { g in
                ForEach(series.indices, id: \.self) { s in
                    let v = g < series[s].count ? series[s][g] : 0
                    let h = max(2, CGFloat(v / maxV) * usable)
                    let gc = groupSlot * (CGFloat(g) + 0.5)
                    let off = (CGFloat(s) - CGFloat(sCount - 1) / 2) * (barW + 2)
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(s == 0 ? AnyShapeStyle(ChartInk.barV) : AnyShapeStyle(DS.Color.fg.opacity(0.22)))
                        .frame(width: barW, height: h)
                        .scaleEffect(x: 1, y: (grow || reduceMotion) ? 1 : 0.001, anchor: .bottom)
                        .opacity((grow || reduceMotion) ? 1 : 0)
                        .animation(reduceMotion ? nil : DS.Motion.appear.delay(Double(g * sCount + s) * 0.03), value: grow)
                        .position(x: gc + off, y: size.height - h / 2)
                }
            }
        }
    }
}

// MARK: - Meter (tick comb)

private struct MeterChart: View {
    let percent: Double
    var legend: [String]?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            GeometryReader { geo in comb(in: geo.size) }
                .frame(height: 56)
            if let legend, !legend.isEmpty { ChartLegend(names: legend) }
        }
        .onAppear { shown = true }
    }

    private func comb(in size: CGSize) -> some View {
        let pct = min(max(percent, 0), 100)
        let n = min(60, max(20, Int(size.width / 6)))
        let slot = size.width / CGFloat(n)
        let tickW = min(slot * 0.42, 3.2)
        let filled = Int((Double(n) * pct / 100).rounded())
        let combTop: CGFloat = 22
        let combH = size.height - combTop
        let boundary = CGFloat(filled) * slot
        return ZStack(alignment: .topLeading) {
            ForEach(Array(0..<n), id: \.self) { i in
                let on = i < filled
                Capsule()
                    .fill(DS.Color.fg)
                    .frame(width: tickW, height: combH)
                    .opacity((shown || reduceMotion) ? (on ? 1 : 0.16) : 0)
                    .animation(reduceMotion ? nil : DS.Motion.appear.delay(Double(i) * 0.008), value: shown)
                    .position(x: slot * (CGFloat(i) + 0.5), y: combTop + combH / 2)
            }
            // Percent marker + caret at the fill boundary.
            Text("\(Int(pct))%")
                .font(.system(size: 12, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(DS.Color.fg)
                .fixedSize()
                .opacity((shown || reduceMotion) ? 1 : 0)
                .animation(reduceMotion ? nil : DS.Motion.appear.delay(Double(filled) * 0.008 + 0.1), value: shown)
                .position(x: min(max(boundary, 16), size.width - 16), y: 8)
            Rectangle()
                .fill(DS.Color.fg)
                .frame(width: 1, height: 8)
                .opacity((shown || reduceMotion) ? 1 : 0)
                .animation(reduceMotion ? nil : DS.Motion.appear.delay(Double(filled) * 0.008 + 0.1), value: shown)
                .position(x: boundary, y: combTop - 5)
        }
    }
}

// MARK: - Line / area

private struct LineChart: View {
    let values: [Double]
    var labels: [String]?
    var highlight: Int?
    var caption: String?
    var filled = true
    var smooth = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drawn = false
    @State private var pillWidth: CGFloat = 0

    /// Strip reserved above the plot when a caption rides the highlight — the
    /// pill lives up here so a peak label can never collide with its own dot
    /// (the old 6pt headroom clamped the caption straight onto it). Bare
    /// charts get 8pt of breathing room.
    private var topInset: CGFloat { (highlight != nil && caption != nil) ? 40 : 8 }

    var body: some View {
        let ticks = axisTicks(labels, count: values.count)
        VStack(spacing: 6) {
            GeometryReader { geo in content(in: geo.size) }
                .frame(height: 140)
            if !ticks.isEmpty { AxisLabels(ticks: ticks, count: values.count) }
        }
        .onAppear {
            guard !reduceMotion else { drawn = true; return }
            withAnimation(.easeInOut(duration: 0.7)) { drawn = true }
        }
    }

    @ViewBuilder
    private func content(in size: CGSize) -> some View {
        let pts = linePoints(values, in: size, topInset: topInset)
        ZStack(alignment: .topLeading) {
            // Baseline hairline — the wash dissolves onto something.
            Rectangle()
                .fill(DS.Color.border)
                .frame(width: size.width, height: 1)
                .position(x: size.width / 2, y: size.height - 2)
            if filled {
                AreaShape(values: values, smooth: smooth, topInset: topInset)
                    .fill(ChartInk.area)
                    .opacity(drawn ? 1 : 0)
            }
            LineShape(values: values, smooth: smooth, topInset: topInset)
                .trim(from: 0, to: drawn ? 1 : 0)
                .stroke(DS.Color.fg, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            if let highlight, highlight >= 0, highlight < pts.count {
                let p = pts[highlight]
                let calloutX = pillCenterX(dotX: p.x, in: size)
                // Gapped leader: pill → dot, touching neither.
                if caption != nil, p.y - 9 > 27 {
                    calloutLeader(from: CGPoint(x: calloutX, y: 24), to: CGPoint(x: p.x, y: p.y - 9))
                        .stroke(DS.Color.fgFaint, style: StrokeStyle(lineWidth: 1, lineCap: .round, lineJoin: .round))
                        .opacity(drawn ? 1 : 0)
                }
                HaloRing()
                    .position(p)
                    .opacity(drawn ? 1 : 0)
                Circle()
                    .fill(DS.Color.fg)
                    .frame(width: 10, height: 10)
                    .overlay(Circle().stroke(DS.Color.bgElevated, lineWidth: 2.5))
                    .position(p)
                    .opacity(drawn ? 1 : 0)
                if let caption {
                    CalloutPill(text: caption)
                        .frame(maxWidth: size.width - 16)
                        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { pillWidth = $0 }
                        .position(x: calloutX, y: 12)
                        .opacity(drawn ? 1 : 0)
                }
            }
        }
    }

    /// Keep the pill fully inside the plot: clamp its center so neither end
    /// crosses the card edge, however close the peak sits to one.
    private func pillCenterX(dotX: CGFloat, in size: CGSize) -> CGFloat {
        let slack = size.width / 2 - pillWidth / 2 - 8
        guard slack > 0 else { return size.width / 2 }
        return size.width / 2 + min(max(dotX - size.width / 2, -slack), slack)
    }

    /// Starts at the pill's center, then bends toward the dot whenever clamping
    /// displaced the pill from its source point.
    private func calloutLeader(from start: CGPoint, to end: CGPoint) -> Path {
        var path = Path()
        path.move(to: start)
        if abs(start.x - end.x) > 0.5, end.y - start.y >= 8 {
            path.addLine(to: CGPoint(x: start.x, y: min(start.y + 8, end.y - 4)))
        }
        path.addLine(to: end)
        return path
    }
}

/// The peak callout as an intentional object: a small elevated pill in the
/// reserved strip, x-clamped so it never clips, tied to its dot by a gapped
/// 1pt leader. Caps its width and truncates rather than breaking geometry
/// when the agent sends a sentence instead of a label.
private struct CalloutPill: View {
    let text: String

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(DS.Color.fg)
                .frame(width: 5, height: 5)
            Text(text)
                .font(.system(size: 11, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(DS.Color.fg)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(DS.Color.bgElevated, in: .capsule)
        .shadow(color: .black.opacity(0.06), radius: 1.5, y: 1)
    }
}

/// Soft pulsing ring behind the highlight dot — emphasis lives in the mark,
/// not in extra ink. Reduce-Motion gets a static ring.
private struct HaloRing: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        Circle()
            .stroke(DS.Color.fg, lineWidth: 1.5)
            .frame(width: 10, height: 10)
            .scaleEffect(reduceMotion ? 1.7 : (pulsing ? 2.4 : 1))
            .opacity(reduceMotion ? 0.3 : (pulsing ? 0 : 0.5))
            .animation(reduceMotion ? nil : .easeOut(duration: 1.8).repeatForever(autoreverses: false), value: pulsing)
            .onAppear { pulsing = true }
    }
}

/// Map a series to plot points. Baseline is pinned to 0 for all-positive data
/// so the area fills from the floor; otherwise it spans the data's own range.
/// `topInset` reserves room above the highest point — bare padding, or the
/// callout strip — so a peak label never clamps down onto its dot.
private func linePoints(_ values: [Double], in size: CGSize, topInset: CGFloat = 8) -> [CGPoint] {
    let n = values.count
    guard n > 0 else { return [] }
    let lo = min(values.min() ?? 0, 0)
    let hi = max(values.max() ?? 1, lo + 0.0001)
    let plotH = size.height - topInset - 3
    func y(_ v: Double) -> CGFloat { topInset + (1 - CGFloat((v - lo) / (hi - lo))) * plotH }
    if n == 1 { return [CGPoint(x: size.width / 2, y: y(values[0]))] }
    return values.enumerated().map { i, v in
        CGPoint(x: CGFloat(i) / CGFloat(n - 1) * size.width, y: y(v))
    }
}

/// Fritsch–Carlson monotone cubic: like the old Catmull-Rom /6 spline but
/// slope-limited, so the curve can never overshoot a data point — the peak
/// dot now sits exactly on the crest instead of below a spline bulge.
private func strokePath(_ pts: [CGPoint], smooth: Bool) -> Path {
    var path = Path()
    guard let first = pts.first else { return path }
    path.move(to: first)
    if smooth && pts.count > 2 {
        let t = monotoneSlopes(pts)
        for i in 0..<(pts.count - 1) {
            let h = (pts[i + 1].x - pts[i].x) / 3
            path.addCurve(
                to: pts[i + 1],
                control1: CGPoint(x: pts[i].x + h, y: pts[i].y + h * t[i]),
                control2: CGPoint(x: pts[i + 1].x - h, y: pts[i + 1].y - h * t[i + 1]))
        }
    } else {
        for i in 1..<pts.count { path.addLine(to: pts[i]) }
    }
    return path
}

/// Slope per point for the monotone spline: secant means, zeroed at local
/// extremes, then Fritsch–Carlson clamped so no segment can overshoot.
private func monotoneSlopes(_ pts: [CGPoint]) -> [CGFloat] {
    let n = pts.count
    var secant = [CGFloat](repeating: 0, count: max(n - 1, 1))
    for i in 0..<(n - 1) {
        let dx = pts[i + 1].x - pts[i].x
        secant[i] = dx != 0 ? (pts[i + 1].y - pts[i].y) / dx : 0
    }
    var t = [CGFloat](repeating: 0, count: n)
    t[0] = secant[0]
    t[n - 1] = secant[n - 2]
    for i in 1..<(n - 1) {
        t[i] = secant[i - 1] * secant[i] <= 0 ? 0 : (secant[i - 1] + secant[i]) / 2
    }
    for i in 0..<(n - 1) where secant[i] != 0 {
        let a = t[i] / secant[i], b = t[i + 1] / secant[i]
        let s = a * a + b * b
        if s > 9 {
            let k = 3 / s.squareRoot()
            t[i] = k * a * secant[i]
            t[i + 1] = k * b * secant[i]
        }
    }
    return t
}

private struct LineShape: Shape {
    let values: [Double]
    var smooth: Bool
    var topInset: CGFloat = 8
    func path(in rect: CGRect) -> Path {
        strokePath(linePoints(values, in: rect.size, topInset: topInset), smooth: smooth)
    }
}

private struct AreaShape: Shape {
    let values: [Double]
    var smooth: Bool
    var topInset: CGFloat = 8
    func path(in rect: CGRect) -> Path {
        let pts = linePoints(values, in: rect.size, topInset: topInset)
        guard let first = pts.first, let last = pts.last else { return Path() }
        var path = strokePath(pts, smooth: smooth)
        path.addLine(to: CGPoint(x: last.x, y: rect.maxY))
        path.addLine(to: CGPoint(x: first.x, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

// MARK: - Heatmap

/// Internal like `ChartInk`: UsagePage renders its when-does-the-agent-work
/// grid with the same cells as gen-UI heatmap cards.
struct HeatmapChart: View {
    let values: [Double]
    var rows: Int
    var columns: Int
    var rowLabels: [String]?
    var columnLabels: [String]?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        let r = max(rows, 1)
        let bottomStrip: CGFloat = (columnLabels?.isEmpty == false) ? 16 : 0
        Canvas { ctx, size in draw(in: ctx, size: size, r: r, bottomStrip: bottomStrip) }
            .frame(height: CGFloat(r) * 18 + bottomStrip)
            .opacity((shown || reduceMotion) ? 1 : 0)
            .animation(reduceMotion ? nil : DS.Motion.appear, value: shown)
            .onAppear { shown = true }
    }

    private func draw(in ctx: GraphicsContext, size: CGSize, r: Int, bottomStrip: CGFloat) {
        let c = max(columns, 1)
        let labelW: CGFloat = (rowLabels?.isEmpty == false) ? 32 : 0
        let gridW = size.width - labelW
        let gridH = size.height - bottomStrip
        let cellW = gridW / CGFloat(c)
        let cellH = gridH / CGFloat(r)
        let gap: CGFloat = 2
        for row in 0..<r {
            for col in 0..<c {
                let idx = row * c + col
                let v = idx < values.count ? min(max(values[idx], 0), 1) : 0
                let rect = CGRect(x: labelW + CGFloat(col) * cellW + gap / 2,
                                  y: CGFloat(row) * cellH + gap / 2,
                                  width: cellW - gap, height: cellH - gap)
                ctx.fill(Path(roundedRect: rect, cornerRadius: 2),
                         with: .color(DS.Color.fg.opacity(0.05 + v * 0.85)))
            }
            if let rowLabels, row < rowLabels.count {
                ctx.draw(Text(rowLabels[row]).font(.system(size: 9)).foregroundColor(DS.Color.fgSubtle),
                         at: CGPoint(x: labelW - 6, y: CGFloat(row) * cellH + cellH / 2), anchor: .trailing)
            }
        }
        if let columnLabels, bottomStrip > 0 {
            for tick in axisTicks(columnLabels, count: c) {
                ctx.draw(Text(tick.text).font(.system(size: 9)).foregroundColor(DS.Color.fgSubtle),
                         at: CGPoint(x: labelW + (CGFloat(tick.id) + 0.5) * cellW, y: gridH + 8),
                         anchor: .center)
            }
        }
    }
}

// MARK: - Previews

#if DEBUG
#Preview("Chart cards") {
    ScrollView {
        VStack(spacing: 16) {
            ForEach(ChartPreviewData.all, id: \.0) { _, spec in
                GenerativeCardView(spec: spec)
            }
        }
        .padding(16)
    }
    .background(DS.Color.bgSubtle)
}

private enum ChartPreviewData {
    static let all: [(String, CardSpec)] = [
        ("bars", parse(#"""
        {"title":"Daily orders · 4 weeks","subtitle":"Peak 156 · May 9",
         "chart":{"type":"bars",
           "values":[94,106,103,112,89,85,120,127,114,101,99,109,96,123,131,120,136,127,146,111,140,132,137,152,149,156,149,139,135,137],
           "labels":["Apr 14","Apr 19","Apr 24","Apr 29","May 4","May 9"],
           "highlight":25,"caption":"156"},
         "footer":"Up 8.2% week over week"}
        """#)),
        ("diverging", parse(#"""
        {"title":"Net daily change · %","subtitle":"+12.6%",
         "chart":{"type":"diverging",
           "values":[2.1,-1.4,3.2,1.1,-2.8,0.8,2.4,-0.6,1.9,3.5,-1.2,2.0,1.4,-0.9,2.7]}}
        """#)),
        ("meter", parse(#"""
        {"title":"Active customers","subtitle":"2,540 total",
         "chart":{"type":"meter","value":78,"legend":["Paid","Free"]}}
        """#)),
        ("line", parse(#"""
        {"title":"Sessions","subtitle":"+12.4% vs last week",
         "chart":{"type":"line","area":true,"smooth":true,
           "values":[6,8,7,11,10,13,15,14,17,16,19,22],
           "labels":["Mon","Wed","Fri","Sun"],"highlight":11,"caption":"22"}}
        """#)),
        ("horizontalBars", parse(#"""
        {"title":"Revenue by campaign",
         "chart":{"type":"horizontalBars",
           "values":[24.8,18,15,11,9,7],
           "labels":["Summer","Retarget","Flash","Email","Loyalty","Referral"],
           "highlight":0}}
        """#)),
        ("groupedBars", parse(#"""
        {"title":"This week vs last",
         "chart":{"type":"groupedBars","legend":["This week","Last week"],
           "series":[[12,18,14,22,19,24,21],[9,14,11,16,15,18,17]],
           "labels":["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]}}
        """#)),
        ("heatmap", parse(#"""
        {"title":"Sales by hour",
         "chart":{"type":"heatmap","rows":4,"columns":12,
           "rowLabels":["Wk1","Wk2","Wk3","Wk4"],
           "columnLabels":["9a","12p","3p","6p","9p","12a"],
           "values":[0.1,0.2,0.4,0.6,0.8,0.9,0.7,0.5,0.3,0.2,0.1,0.05,
                     0.2,0.3,0.5,0.7,0.9,1.0,0.8,0.6,0.4,0.3,0.2,0.1,
                     0.05,0.15,0.35,0.55,0.75,0.85,0.65,0.45,0.25,0.15,0.1,0.05,
                     0.1,0.25,0.45,0.65,0.85,0.95,0.75,0.55,0.35,0.2,0.15,0.1]}}
        """#)),
    ]

    static func parse(_ json: String) -> CardSpec { CardSpec.parse(json)! }
}
#endif
