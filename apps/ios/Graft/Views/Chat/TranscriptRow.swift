import UIKit
import SwiftUI

/// One transcript row. Takes the persisted `@Observable` item so streaming
/// appends invalidate only this row. The switch is wrapped in a single-root
/// container to keep the row unary for the lazy stack.
struct TranscriptRow: View {
    @Environment(AppModel.self) private var app
    let item: TranscriptItem
    var showInlineReasoning = true
    var foldedActivityItems: [TranscriptItem] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch item.kind {
            case .user:
                UserBubble(item: item)
            case .assistant:
                AssistantMessage(
                    item: item,
                    showReasoning: app.settings.showReasoning && showInlineReasoning,
                    foldedActivityItems: foldedActivityItems
                )
            case .tool:
                ToolCallCard(item: item)
            case .agents:
                AgentThreadsView(item: item)
            case .system:
                CenteredNote(text: item.text, color: .secondary)
            case .error:
                CenteredNote(text: item.text, color: .red)
            }
        }
    }
}

private struct UserBubble: View {
    let item: TranscriptItem

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            if !item.images.isEmpty {
                HStack(alignment: .top, spacing: 6) {
                    Spacer(minLength: 56)
                    ForEach(item.images) { image in
                        ChatImageView(chatImage: image, style: .tile)
                    }
                }
            }
            if !item.text.isEmpty {
                if item.isOversized {
                    LongMessageView(text: item.text, alignment: .trailing)
                } else {
                    userText
                }
            }
        }
    }

    private var userText: some View {
        HStack {
            Spacer(minLength: 56)
            Text(item.text)
                .textSelection(.enabled)
                .font(DS.Font.body)
                .foregroundStyle(DS.Color.fg)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(DS.Color.bubbleFill, in: .rect(cornerRadius: DS.Radius.bubble))
                .contextMenu {
                    Button {
                        UIPasteboard.general.string = item.text
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                    ShareLink(item: item.text) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                }
        }
    }
}

private struct AssistantMessage: View {
    let item: TranscriptItem
    let showReasoning: Bool
    let foldedActivityItems: [TranscriptItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if shouldShowReasoningBlock {
                ReasoningView(
                    item: item,
                    foldedActivityItems: foldedActivityItems,
                    includeReasoning: showReasoning
                )
            }
            if !item.text.isEmpty {
                if item.isOversized {
                    LongMessageView(text: item.text)
                } else {
                    StreamingAssistantText(text: item.text, isStreaming: item.isStreaming)
                }
            }
            if !item.images.isEmpty {
                AssistantMediaGrid(images: item.images)
            }
            ForEach(item.videos) { video in
                ChatVideoView(video: video)
            }
            if !item.linkPreviews.isEmpty {
                SourcesPill(previews: item.linkPreviews)
                    .padding(.top, 2)
            }
            if !item.isStreaming, !item.text.isEmpty {
                MessageActionBar(item: item)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear {
            // History rows past the recent window aren't eager-attached at load
            // (that's the open-thread freeze). Attach their rich content now,
            // the first time they scroll into view. Idempotent via
            // `richContentAttached`; skipped for streaming rows, whose content
            // is attached when the live turn completes.
            guard !item.isStreaming, !item.richContentAttached else { return }
            ChatModel.attachRichContent(to: item)
        }
    }

    private var shouldShowReasoningBlock: Bool {
        if showReasoning {
            if !item.reasoning.isEmpty { return true }
            if foldedActivityItems.contains(where: { $0.kind == .assistant && !$0.reasoning.isEmpty }) {
                return true
            }
        }
        return foldedActivityItems.contains { $0.kind == .tool }
    }
}

/// Coalesces rapid snapshots without holding back received text.
private struct StreamingAssistantText: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let text: String
    let isStreaming: Bool

    @State private var stream: StreamingReveal
    @State private var reveal: Double = 1
    @State private var lastHapticAt = Date.distantPast
    @State private var hapticTick = 0

    init(text: String, isStreaming: Bool) {
        self.text = text
        self.isStreaming = isStreaming
        _stream = State(initialValue: StreamingReveal(text: text))
    }

    var body: some View {
        MarkdownText(
            !isStreaming || reduceMotion ? text : stream.displayedText,
            revealTail: isStreaming && !reduceMotion ? reveal : nil
        )
            .sensoryFeedback(.impact(flexibility: .rigid, intensity: 0.65), trigger: hapticTick)
            .onChange(of: text) { _, newText in
                receive(newText)
            }
            .onChange(of: isStreaming) { _, _ in
                receive(text)
            }
            .task(id: RevealLoopID(streaming: isStreaming, reduceMotion: reduceMotion)) {
                receive(text)
                guard isStreaming, !reduceMotion else { return }
                await runRevealLoop()
            }
    }

    @MainActor
    private func receive(_ text: String) {
        stream.receive(text, isStreaming: isStreaming, reduceMotion: reduceMotion)
        if stream.displayedText == text { reveal = 1 }
    }

    @MainActor
    private func runRevealLoop() async {
        while !Task.isCancelled {
            do {
                try await Task.sleep(for: .milliseconds(StreamingReveal.commitIntervalMilliseconds))
            } catch {
                return
            }
            guard !Task.isCancelled, stream.displayedText != stream.targetText else { continue }

            let previousLength = stream.displayedText.utf16.count
            let nextLength = stream.targetText.utf16.count
            let settled = Double(previousLength) / Double(max(nextLength, 1))
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                stream.commit()
                reveal = min(reveal, settled)
            }
            withAnimation(.easeOut(duration: 0.12)) {
                reveal = 1
            }

            let now = Date()
            if now.timeIntervalSince(lastHapticAt) >= 0.1 {
                lastHapticAt = now
                hapticTick &+= 1
            }
        }
    }

    private struct RevealLoopID: Hashable {
        let streaming: Bool
        let reduceMotion: Bool
    }
}

private struct AssistantMediaGrid: View {
    let images: [ChatImage]

    private let columns = [
        GridItem(.fixed(142), spacing: 8, alignment: .leading),
        GridItem(.fixed(142), spacing: 8, alignment: .leading),
    ]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
            ForEach(images) { image in
                ChatImageView(chatImage: image, style: .compact)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 2)
    }
}

/// A stable, expandable reasoning summary. Live progress belongs to the footer.
private struct ReasoningView: View {
    let item: TranscriptItem
    var foldedActivityItems: [TranscriptItem] = []
    var includeReasoning = true
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.snappy) { expanded.toggle() }
            } label: {
                HStack(spacing: 5) {
                    Text(headerText)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(DS.Color.fgSubtle)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                    if !toolPresentations.isEmpty {
                        BrandCircleStack(presentations: toolPresentations)
                            .padding(.leading, 2)
                    }
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)

            if expanded {
                expandedContent
            }
        }
    }

    @ViewBuilder
    private var expandedContent: some View {
        if foldedActivityItems.isEmpty {
            Text(item.reasoning)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .padding(.leading, 10)
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(.quaternary)
                        .frame(width: 2)
                }
                .transition(.opacity)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(activityTimelineItems) { activityItem in
                    if activityItem.kind == .tool {
                        ToolCallCard(item: activityItem)
                    } else {
                        ExpandedThought(item: activityItem)
                    }
                }
            }
            .padding(.leading, 6)
            .transition(.opacity)
        }
    }

    private var headerText: String {
        if !foldedActivityItems.isEmpty {
            return ToolActivityStrip.summaryPhrase(for: summaryItems)
        }
        if let duration = item.reasoningDuration, duration >= 0.5 {
            return "Thought for \(Self.format(duration))"
        }
        return "Thoughts"
    }

    private var activityTimelineItems: [TranscriptItem] {
        var result = foldedActivityItems.filter { activityItem in
            switch activityItem.kind {
            case .tool:
                return true
            case .assistant:
                return includeReasoning && !activityItem.reasoning.isEmpty
            case .agents, .user, .system, .error:
                return false
            }
        }
        if includeReasoning, !item.reasoning.isEmpty {
            result.append(item)
        }
        return result
    }

    private var summaryItems: [TranscriptItem] {
        var result = foldedActivityItems.filter { activityItem in
            activityItem.kind == .tool || (includeReasoning && activityItem.kind == .assistant)
        }
        if includeReasoning, !item.reasoning.isEmpty {
            result.append(item)
        }
        return result
    }

    private var latestReasoning: String {
        if includeReasoning, !item.reasoning.isEmpty {
            return item.reasoning
        }
        return foldedActivityItems
            .last { $0.kind == .assistant && !$0.reasoning.isEmpty }
            .map(\.reasoning) ?? ""
    }

    private var toolPresentations: [ToolPresentation] {
        foldedActivityItems
            .filter { $0.kind == .tool }
            .map { ToolPresentation(name: $0.toolName, context: $0.toolContext) }
    }

    private static func format(_ seconds: Double) -> String {
        if seconds < 60 { return "\(max(1, Int(seconds.rounded())))s" }
        let minutes = Int(seconds / 60)
        let rest = Int(seconds) % 60
        return rest == 0 ? "\(minutes)m" : "\(minutes)m \(rest)s"
    }
}

private struct CenteredNote: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(color)
            .frame(maxWidth: .infinity, alignment: .center)
            .multilineTextAlignment(.center)
    }
}

/// Renders an oversized message without ever handing it to the markdown engine.
/// Parsing/laying out a multi-KB/MB message via `AttributedString(markdown:)` +
/// the glyph renderer on the main thread during first paint is what froze the
/// transcript and got the app watchdog-killed (a background-job log/code dump
/// as the latest turn of a thread). For these rare giant rows we show a cheap
/// plain-text preview and move the full text behind an explicit tap.
private struct LongMessageView: View {
    let text: String
    var alignment: HorizontalAlignment = .leading
    @State private var showingFull = false

    private static let previewLimit = 1_200

    private var frameAlignment: Alignment { alignment == .trailing ? .trailing : .leading }

    var body: some View {
        VStack(alignment: alignment, spacing: 8) {
            Text(String(text.prefix(Self.previewLimit)) + "…")
                .font(MarkdownStyle.body)
                .lineSpacing(MarkdownStyle.lineSpacing)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: frameAlignment)
            Button {
                showingFull = true
            } label: {
                Label("Show full message", systemImage: "text.viewfinder")
                    .font(.footnote.weight(.medium))
            }
            .buttonStyle(.plain)
            .foregroundStyle(DS.Color.accent)
        }
        .frame(maxWidth: .infinity, alignment: frameAlignment)
        .sheet(isPresented: $showingFull) {
            SelectableTextSheet(text: String(text.prefix(TranscriptItem.maxRenderedChars)))
        }
    }
}
