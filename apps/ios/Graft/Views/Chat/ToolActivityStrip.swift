import SwiftUI

/// Stable work details; the transcript footer owns live progress.
struct ToolActivityStrip: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let items: [TranscriptItem]

    @State private var expanded = false

    private var toolEntries: [(item: TranscriptItem, presentation: ToolPresentation)] {
        items.filter { $0.kind == .tool }
            .map { ($0, ToolPresentation(name: $0.toolName, context: $0.toolContext)) }
    }

    private var hasExpandableDetails: Bool {
        hasReasoning || !toolEntries.isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            summaryRow
            if expanded, hasExpandableDetails {
                expandedTimeline.padding(.leading, 6)
            }
        }
    }

    // MARK: Live timeline

    /// Reasoning segments in this turn — the chain of thought revealed when the
    /// header is tapped. Empty on a pure tool turn, which hides the chevron.
    private var reasoningItems: [TranscriptItem] {
        items.filter { $0.kind == .assistant && !$0.reasoning.isEmpty }
    }

    private var hasReasoning: Bool { !reasoningItems.isEmpty }

    // MARK: Collapsed summary

    private var summaryRow: some View {
        let tools = toolEntries
        return Button {
            withAnimation(reduceMotion ? nil : .snappy) { expanded.toggle() }
        } label: {
            HStack(spacing: 9) {
                if let tool = tools.last {
                    Image(systemName: tool.presentation.symbol)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(width: 20)
                }
                Text(summaryPhrase)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(DS.Color.fgSubtle)
                    .rotationEffect(.degrees(expanded ? 90 : 0))
                Spacer(minLength: 0)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private var expandedTimeline: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(items) { item in
                if item.kind == .tool {
                    ToolCallCard(item: item)
                } else {
                    ExpandedThought(item: item)
                }
            }
        }
    }

    private var summaryPhrase: String {
        Self.summaryPhrase(for: items)
    }

    static func summaryPhrase(for items: [TranscriptItem]) -> String {
        let summaryReasoningItems = items.filter {
            $0.kind == .assistant && !$0.reasoning.isEmpty && $0.text.isEmpty
        }
        let thoughtItems = summaryReasoningItems.isEmpty
            ? items.filter { $0.kind == .assistant && !$0.reasoning.isEmpty }
            : summaryReasoningItems
        let thoughtSeconds = thoughtItems
            .compactMap(\.reasoningDuration)
            .reduce(0, +)
        if thoughtSeconds >= 0.5 {
            return "Thought for \(max(1, Int(thoughtSeconds.rounded())))s"
        }
        let toolCount = items.filter { $0.kind == .tool }.count
        if toolCount > 0 {
            return toolCount == 1 ? "Used 1 tool" : "Used \(toolCount) tools"
        }
        return "Worked"
    }

    static func turnSummaryPhrase(for items: [TranscriptItem]) -> String {
        guard let start = items.compactMap(\.createdAt).filter({ $0 > 0 }).min(),
              let end = items.compactMap(\.completedAt).max(), end > start else { return "Worked" }
        let seconds = max(1, (end - start) / 1000)
        let duration = seconds < 60 ? "\(seconds)s"
            : seconds % 60 == 0 ? "\(seconds / 60)m" : "\(seconds / 60)m \(seconds % 60)s"
        return "Worked for \(duration)"
    }

    #if DEBUG
    static func debugSummaryPhrase(for items: [TranscriptItem]) -> String {
        summaryPhrase(for: items)
    }

    static func debugLivePhrase(for items: [TranscriptItem]) -> String {
        LiveStatusPhrase.current(from: items)
    }
    #endif
}

/// A thinking segment inside the expanded trace: header + full text. The live
/// (still-streaming) segment opens by default so the chain of thought is there
/// the instant you reveal it; sealed segments stay folded to their duration.
struct ExpandedThought: View {
    @Environment(\.transcriptConnectionActive) private var connectionActive
    let item: TranscriptItem
    @State private var open: Bool

    init(item: TranscriptItem) {
        self.item = item
        _open = State(initialValue: item.reasoningDuration == nil)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.snappy) { open.toggle() }
            } label: {
                HStack(spacing: 5) {
                    Text(header)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(DS.Color.fgSubtle)
                        .rotationEffect(.degrees(open ? 90 : 0))
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if open {
                Text(item.reasoning)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .padding(.leading, 10)
                    .overlay(alignment: .leading) {
                        Rectangle().fill(.quaternary).frame(width: 2)
                    }
                    .transition(.opacity)
            }
        }
    }

    private var header: String {
        if let duration = item.reasoningDuration, duration >= 0.5 {
            return "Thought for \(max(1, Int(duration.rounded())))s"
        }
        return item.isStreaming && connectionActive ? "Thinking" : "Thought"
    }
}

/// Horizontally overlapping circles, deduped by brand identity, capped at
/// four with a "+N" tail.
struct BrandCircleStack: View {
    let presentations: [ToolPresentation]

    private var unique: [ToolPresentation] {
        var seen = Set<String>()
        var result: [ToolPresentation] = []
        for presentation in presentations where !seen.contains(presentation.circleKey) {
            seen.insert(presentation.circleKey)
            result.append(presentation)
        }
        return result
    }

    var body: some View {
        let unique = unique
        let shown = Array(unique.prefix(4))
        let overflow = unique.count - shown.count
        HStack(spacing: -8) {
            ForEach(Array(shown.enumerated()), id: \.element.circleKey) { index, presentation in
                BrandIcon(presentation: presentation)
                    .background(
                        Circle().fill(DS.Color.bg).frame(width: 30, height: 30)
                    )
                    .zIndex(Double(index))
                    .transition(.scale(scale: 0.5).combined(with: .opacity))
            }
            if overflow > 0 {
                Text("+\(overflow)")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(DS.Color.fgSubtle)
                    .frame(width: 26, height: 26)
                    .background(DS.Color.bgSubtle, in: .circle)
                    .background(Circle().fill(DS.Color.bg).frame(width: 30, height: 30))
                    .zIndex(10)
            }
        }
        .animation(.snappy(duration: 0.3), value: unique.map(\.circleKey))
    }
}
