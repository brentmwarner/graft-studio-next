//
//  GenerativeCardBlocks.swift
//  Fetch — composable body blocks for generative-UI cards
//
//  A `CardSpec` may carry an ordered `blocks` array. Each block is one typed
//  unit of content (a metric, a progress bar, a checklist, a distribution, a
//  comparison, …) and the agent stacks any combination inside the one Panel
//  frame — a card is "one frame + a stack of blocks," not a fixed catalog of
//  card types. New use case → new composition (zero code); new visual → one
//  additive block.
//
//  Like `CardSpec` / `ChartSpec`, the model is flat and all-optional, and `kind`
//  is forgiving: an explicit `type` (with aliases) wins, but a block with no
//  `type` is inferred from whichever payload field is present — so the agent is
//  never boxed into a rigid shape. Everything is pure monochrome DS ink
//  (direction by opacity, status hue only on a metric delta), tuned in the web
//  studio: explorations/gen-ui-cards/index.html
//

import SwiftUI

// MARK: - Block model

/// One composable block in a card body. All fields optional; the model fills
/// only the ones a given block needs.
struct CardBlock: Decodable, Equatable {
    var type: String?

    // text / note
    var title: String?
    var text: String?
    var body: String?

    // metric — one hero number with a trend + optional sparkline
    var value: FlexibleString?
    var label: String?
    var delta: String?
    var trend: String?
    var spark: [Double]?

    // stats — even big-number columns (reuses `CardSpec.Stat`)
    var stats: [CardSpec.Stat]?

    // rows — tappable list rows (reuses `CardSpec.Item`)
    var items: [CardSpec.Item]?

    // progress — a bar with a caption + percent
    var percent: Double?
    var caption: String?

    // checklist — step states (done · now · next)
    var steps: [Step]?

    // bars — a distribution / breakdown
    var bars: [Bar]?

    // compare — 2–3 options, one recommended
    var options: [Option]?

    // chart — a native chart, ordered among the other blocks
    var chart: ChartSpec?

    struct Step: Decodable, Equatable {
        var title: String?
        /// `done` · `now` · `next` (aliases tolerated). Anything unknown → next.
        var state: String?
        /// Optional trailing chip override; otherwise `now` shows "Now".
        var tag: String?
    }

    struct Bar: Decodable, Equatable {
        var label: String?
        /// Display value, e.g. "42%". Also drives the fill when `fraction` is
        /// absent (largest value fills the track).
        var value: FlexibleString?
        /// Explicit 0…1 fill. Wins over `value` when present.
        var fraction: Double?
        /// Render the fill faint — for the trailing items in a ranked split.
        var mute: Bool?
    }

    struct Option: Decodable, Equatable {
        var name: String?
        var value: FlexibleString?
        var unit: String?
        var note: String?
        /// Marks the recommended option — solid border + a "Pick" badge.
        var pick: Bool?
        /// Override the "Pick" badge text.
        var badge: String?
    }

    enum Kind: Equatable {
        case text, metric, stats, rows, progress, checklist, bars, compare, chart, divider
    }

    /// Forgiving resolution: an explicit `type` (with aliases) wins; otherwise
    /// infer from whichever payload field is present. `nil` → the block renders
    /// nothing and doesn't count toward the card's substance gate.
    var kind: Kind? {
        if let type {
            switch type.lowercased().filter({ $0.isLetter }) {
            case "text", "note", "paragraph", "body", "prose": return .text
            case "metric", "bignumber", "kpi", "number", "hero", "stat": return .metric
            case "stats", "statgrid", "statcolumns", "statistics", "metrics": return .stats
            case "rows", "list", "rowlist", "links": return .rows
            case "progress", "progressbar", "bar": return .progress
            case "checklist", "checks", "steps", "todo", "tasks", "checkbox": return .checklist
            case "bars", "breakdown", "distribution", "barlist", "split": return .bars
            case "compare", "comparison", "options", "versus", "vs", "choices": return .compare
            case "chart": return chart?.kind != nil ? .chart : nil
            case "divider", "rule", "separator", "hr", "line": return .divider
            default: break  // unknown type → fall through to inference
            }
        }
        return inferredKind
    }

    /// What the block looks like it is, from its payload alone.
    private var inferredKind: Kind? {
        if chart?.kind != nil { return .chart }
        if steps?.isEmpty == false { return .checklist }
        if options?.isEmpty == false { return .compare }
        if bars?.isEmpty == false { return .bars }
        if stats?.isEmpty == false { return .stats }
        if items?.isEmpty == false { return .rows }
        if percent != nil { return .progress }
        if value != nil { return .metric }
        if (text ?? body) != nil { return .text }
        return nil
    }

    var bodyText: String? { text ?? body }

    /// Whether this block actually draws something. `kind` reflects the agent's
    /// *intent* — an explicit `type` resolves even with no payload — so a typed-
    /// but-empty block like `{"type":"metric"}` would otherwise pass the card's
    /// substance gate and render a blank slot (while suppressing the legacy
    /// body). The gate and `renderableBlocks` filter on this, not on `kind`.
    var rendersContent: Bool {
        switch kind {
        case .text:      return title != nil || bodyText != nil
        case .metric:    return value != nil || label != nil || delta != nil
        case .stats:     return stats?.isEmpty == false
        case .rows:      return items?.isEmpty == false
        case .progress:  return percent != nil
        case .checklist: return steps?.isEmpty == false
        case .bars:      return bars?.isEmpty == false
        case .compare:   return options?.isEmpty == false
        case .chart:     return chart?.kind != nil
        case .divider:   return true
        case .none:      return false
        }
    }
}

// MARK: - Router

/// Renders one `CardBlock` as the right native view, sized intrinsically so it
/// drops straight into the card's body `VStack`. Each block rises in as a unit.
struct CardBlockView: View {
    let block: CardBlock
    let shown: Bool
    var delay: Double = 0

    var body: some View {
        content.riseIn(shown, delay: delay)
    }

    @ViewBuilder
    private var content: some View {
        switch block.kind {
        case .text:      TextBlockView(block: block)
        case .metric:    MetricBlockView(block: block)
        case .stats:     StatsBlockView(stats: Array((block.stats ?? []).prefix(4)))
        case .rows:      RowsBlockView(items: block.items ?? [])
        case .progress:  ProgressBlockView(block: block)
        case .checklist: ChecklistBlockView(steps: block.steps ?? [])
        case .bars:      BarsBlockView(bars: block.bars ?? [])
        case .compare:   CompareBlockView(options: Array((block.options ?? []).prefix(3)))
        case .chart:     if let chart = block.chart { GenerativeChartView(spec: chart) }
        case .divider:   Rectangle().fill(DS.Color.border).frame(height: 1)
        case .none:      EmptyView()
        }
    }
}

// MARK: - Text

/// A paragraph (optional title + body) — for framing or a "so what" note that
/// wants to sit between other blocks rather than in the footer.
private struct TextBlockView: View {
    let block: CardBlock

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let title = block.title {
                Text(title)
                    .font(DS.Font.callout)
                    .foregroundStyle(DS.Color.fg)
            }
            if let body = block.bodyText {
                // InlineText, not Text: card prose can carry markdown links
                // and bare URLs (a leads digest), and both must stay tappable.
                InlineText(body)
                    .font(DS.Font.footnote)
                    .foregroundStyle(DS.Color.fgSubtle)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Metric

/// One hero number with a caption, a trend delta, and an optional quiet
/// sparkline — for a single-number answer (throughput, spend, a streak).
private struct MetricBlockView: View {
    let block: CardBlock

    var body: some View {
        HStack(alignment: .bottom, spacing: DS.Space.s2) {
            VStack(alignment: .leading, spacing: 5) {
                if let value = block.value?.value {
                    Text(value)
                        .font(DS.Font.display1)
                        .monospacedDigit()
                        .tracking(DS.Tracking.display)
                        .foregroundStyle(DS.Color.fg)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                if block.label != nil || block.delta != nil {
                    HStack(spacing: 8) {
                        if let label = block.label {
                            Text(label)
                                .font(DS.Font.footnote)
                                .foregroundStyle(DS.Color.fgSubtle)
                        }
                        if let delta = block.delta {
                            Text(delta)
                                .font(.system(size: 13, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(deltaColor)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
            if let spark = block.spark, spark.count > 1 {
                Sparkline(values: spark)
                    .frame(width: CGFloat(min(spark.count, 16)) * 10, height: 44)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Status hue is allowed here — a metric delta is data/feedback, not chrome.
    /// Respect an explicit `trend`; otherwise read the sign of the delta string.
    private var deltaColor: SwiftUI.Color {
        switch block.trend?.lowercased() {
        case "up", "good", "positive": return DS.Color.success
        case "down", "bad", "negative": return DS.Color.danger
        case "flat", "neutral", "none": return DS.Color.fgSubtle
        case .some: return DS.Color.fgSubtle
        case .none:
            guard let d = block.delta?.lowercased() else { return DS.Color.fgSubtle }
            if d.contains("▲") || d.hasPrefix("+") || d.contains("up") { return DS.Color.success }
            if d.contains("▼") || d.hasPrefix("-") || d.contains("−") || d.contains("down") { return DS.Color.danger }
            return DS.Color.fgSubtle
        }
    }
}

/// A small monochrome bar sparkline — the latest bar in solid ink, the rest
/// faint. Quiet by design: a glyph, not a chart.
private struct Sparkline: View {
    let values: [Double]

    var body: some View {
        let maxV = max(values.max() ?? 1, 0.0001)
        HStack(alignment: .bottom, spacing: 4) {
            ForEach(Array(values.enumerated()), id: \.offset) { idx, v in
                RoundedRectangle(cornerRadius: 2)
                    .fill(idx == values.count - 1 ? DS.Color.fg : DS.Color.fgFaint)
                    .frame(maxWidth: .infinity)
                    .frame(height: max(3, CGFloat(v / maxV) * 44))
            }
        }
    }
}

// MARK: - Stats

/// Even big-number columns (short values) or quiet key–value rows (long
/// values) — the same auto-switching register as the legacy top-level `stats`.
private struct StatsBlockView: View {
    let stats: [CardSpec.Stat]

    var body: some View {
        if stats.allSatisfy({ ($0.value?.value ?? "—").count <= 10 }) {
            HStack(alignment: .firstTextBaseline, spacing: DS.Space.s2) {
                ForEach(Array(stats.enumerated()), id: \.offset) { _, stat in
                    StatColumn(stat: stat)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 7) {
                ForEach(Array(stats.enumerated()), id: \.offset) { _, stat in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(stat.label ?? "")
                            .font(DS.Font.footnote)
                            .foregroundStyle(DS.Color.fgSubtle)
                            .frame(width: 88, alignment: .leading)
                        Text(stat.value?.value ?? "—")
                            .font(DS.Font.subhead)
                            .foregroundStyle(DS.Color.fg)
                    }
                }
            }
        }
    }
}

// MARK: - Rows

/// Tappable list rows — reuses the legacy `CardItemRow` so a row inside a
/// `blocks` stack behaves exactly like a top-level `items` row.
private struct RowsBlockView: View {
    let items: [CardSpec.Item]

    var body: some View {
        // Icons are all-or-nothing: one icon-less row would break the left edge.
        let allHaveIcons = items.allSatisfy {
            CardIcon.resolve(emoji: $0.emoji, symbol: $0.symbol) != nil
        }
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                CardItemRow(item: item, showIcon: allHaveIcons)
            }
        }
    }
}

// MARK: - Progress

/// A progress bar with a caption ("2 of 4 steps") and a percent — for long
/// work in flight.
private struct ProgressBlockView: View {
    let block: CardBlock

    private var fraction: CGFloat {
        guard let p = block.percent else { return 0 }
        return max(0, min(1, CGFloat(p) / 100))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            if block.caption != nil || block.percent != nil {
                HStack(alignment: .firstTextBaseline) {
                    if let caption = block.caption {
                        Text(caption)
                            .font(DS.Font.footnote)
                            .foregroundStyle(DS.Color.fgSubtle)
                    }
                    Spacer(minLength: 8)
                    if let p = block.percent {
                        Text("\(Int(p.rounded()))%")
                            .font(.system(size: 13, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(DS.Color.fgMuted)
                    }
                }
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(DS.Color.bgMuted)
                    Capsule().fill(DS.Color.fg)
                        .frame(width: geo.size.width * fraction)
                }
            }
            .frame(height: 6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Checklist

/// Step states (done / now / next) with checkbox glyphs — the agent's most
/// common card body, for a multi-step job.
private struct ChecklistBlockView: View {
    let steps: [CardBlock.Step]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.offset) { idx, step in
                if idx > 0 {
                    Rectangle().fill(DS.Color.border).frame(height: 1)
                }
                ChecklistRow(step: step)
            }
        }
    }
}

private struct ChecklistRow: View {
    let step: CardBlock.Step

    private enum StepState { case done, now, next }

    private var state: StepState {
        switch step.state?.lowercased().filter({ $0.isLetter }) {
        case "done", "complete", "completed", "checked", "finished", "shipped": return .done
        case "now", "active", "current", "inprogress", "doing", "running": return .now
        default: return .next
        }
    }

    private var tag: String? {
        if let t = step.tag { return t }
        return state == .now ? "Now" : nil
    }

    var body: some View {
        HStack(spacing: 11) {
            box
            Text(step.title ?? "")
                .font(DS.Font.callout)
                .foregroundStyle(state == .done ? DS.Color.fgSubtle : DS.Color.fg)
                .strikethrough(state == .done, color: DS.Color.fgFaint)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 8)
            if let tag {
                Text(tag).dsChip()
            }
        }
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var box: some View {
        switch state {
        case .done:
            RoundedRectangle(cornerRadius: 6)
                .fill(DS.Color.fg)
                .frame(width: 19, height: 19)
                .overlay(
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(DS.Color.accentFg)
                )
        case .now:
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(DS.Color.fg, lineWidth: 1.5)
                .frame(width: 19, height: 19)
        case .next:
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(DS.Color.borderStrong, lineWidth: 1.5)
                .frame(width: 19, height: 19)
        }
    }
}

// MARK: - Bars (breakdown / distribution)

/// A whole split into labeled inline bars — for where the budget / time /
/// storage went. Lead items render solid; `mute` items render faint.
private struct BarsBlockView: View {
    let bars: [CardBlock.Bar]

    private var maxValue: Double {
        let nums = bars.compactMap { numericValue($0.value?.value) }
        return max(nums.max() ?? 1, 0.0001)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            ForEach(Array(bars.enumerated()), id: \.offset) { _, bar in
                BarRow(bar: bar, fraction: fraction(for: bar))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func fraction(for bar: CardBlock.Bar) -> CGFloat {
        if let f = bar.fraction { return CGFloat(max(0, min(1, f))) }
        if let n = numericValue(bar.value?.value) {
            return CGFloat(max(0, min(1, n / maxValue)))
        }
        return 0
    }
}

private struct BarRow: View {
    let bar: CardBlock.Bar
    let fraction: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(bar.label ?? "")
                    .font(DS.Font.footnote)
                    .foregroundStyle(DS.Color.fgMuted)
                Spacer(minLength: 8)
                if let v = bar.value?.value, !v.isEmpty {
                    Text(v)
                        .font(.system(size: 13, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(DS.Color.fg)
                }
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(DS.Color.bgMuted)
                    Capsule().fill((bar.mute ?? false) ? DS.Color.fgFaint : DS.Color.fg)
                        .frame(width: geo.size.width * fraction)
                }
            }
            .frame(height: 8)
        }
    }
}

// MARK: - Compare

/// Two or three options side by side, one marked recommended — for a decision
/// the agent has already made a pick on.
private struct CompareBlockView: View {
    let options: [CardBlock.Option]

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                CompareColumn(option: option)
            }
        }
    }
}

private struct CompareColumn: View {
    let option: CardBlock.Option

    private var picked: Bool { option.pick ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let name = option.name {
                Text(name)
                    .font(DS.Font.subhead)
                    .foregroundStyle(DS.Color.fg)
            }
            if option.value != nil || option.unit != nil {
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    if let v = option.value?.value {
                        Text(v)
                            .font(DS.Font.title2)
                            .monospacedDigit()
                            .foregroundStyle(DS.Color.fg)
                    }
                    if let unit = option.unit {
                        Text(unit)
                            .font(DS.Font.footnote)
                            .foregroundStyle(DS.Color.fgSubtle)
                    }
                }
            }
            if let note = option.note {
                Text(note)
                    .font(DS.Font.footnote)
                    .foregroundStyle(DS.Color.fgSubtle)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DS.Color.bgElevated, in: .rect(cornerRadius: DS.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: DS.Radius.md)
                .strokeBorder(picked ? DS.Color.fg : DS.Color.border,
                              lineWidth: picked ? 1.5 : 1)
        )
        .overlay(alignment: .topLeading) {
            if picked {
                Text(option.badge ?? "Pick")
                    .font(.system(size: 10, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(0.4)
                    .foregroundStyle(DS.Color.accentFg)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(DS.Color.fg, in: .capsule)
                    .padding(.leading, 13)
                    .offset(y: -9)
            }
        }
    }
}

// MARK: - Shared

/// Pull the leading numeric magnitude out of a display string ("42%" → 42,
/// "$1,250" → 1250) so a bar can size itself when no explicit `fraction` is set.
private func numericValue(_ string: String?) -> Double? {
    guard let string else { return nil }
    let filtered = string.filter { $0.isNumber || $0 == "." || $0 == "-" }
    return Double(filtered)
}
