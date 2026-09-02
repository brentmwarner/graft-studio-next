import SwiftUI

/// One turn's working timeline: the tool calls AND the thinking segments
/// interleaved between them. While the turn is working it presents
/// live activity — the composing orb plus a phrase that starts as
/// "Thinking" and swaps to the current action.
/// Tapping the header reveals the hidden details. If no assistant reply
/// row claims the settled work, every step collapses into one quiet
/// summary row here.
struct ToolActivityStrip: View {
    let items: [TranscriptItem]

    @State private var expanded = false

    private var isWorking: Bool {
        items.contains { $0.toolStatus == .running || ($0.kind == .assistant && $0.isStreaming) }
    }

    private var toolEntries: [(item: TranscriptItem, presentation: ToolPresentation)] {
        items.filter { $0.kind == .tool }
            .map { ($0, ToolPresentation(name: $0.toolName, context: $0.toolContext)) }
    }

    /// Tool calls shown as the header's brand-circle stack while work is active.
    private var toolPresentations: [ToolPresentation] {
        items.filter { $0.kind == .tool }
            .map { ToolPresentation(name: $0.toolName, context: $0.toolContext) }
    }

    private var hasExpandableDetails: Bool {
        hasReasoning || !toolEntries.isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if isWorking {
                LiveStatusLine(
                    phrase: livePhrase,
                    canReveal: hasExpandableDetails,
                    revealed: expanded,
                    tools: toolPresentations,
                    onTap: { withAnimation(.snappy) { expanded.toggle() } }
                )
                // Tapping the header reveals the hidden reasoning/tool details.
                if expanded, hasExpandableDetails {
                    expandedTimeline
                        .padding(.leading, 6)
                        .transition(.opacity)
                }
            } else {
                summaryRow
                if expanded {
                    expandedTimeline
                        .padding(.leading, 6)
                        .transition(.opacity)
                }
            }
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.85), value: isWorking)
        .animation(.snappy(duration: 0.3), value: toolEntries.map(\.item.id))
        .animation(.spring(response: 0.32, dampingFraction: 0.88), value: livePhrase)
    }

    private var livePhrase: String {
        LiveStatusPhrase.current(from: items)
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
            withAnimation(.snappy) { expanded.toggle() }
        } label: {
            HStack(spacing: 9) {
                if !tools.isEmpty {
                    BrandCircleStack(presentations: tools.map(\.presentation))
                }
                Text(summaryPhrase)
                    .font(.subheadline.weight(.medium))
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
        return item.isStreaming ? "Thinking" : "Thought"
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
