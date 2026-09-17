import UIKit
import SwiftUI

/// One transcript row. Takes the persisted `@Observable` item so streaming
/// appends invalidate only this row. The switch is wrapped in a single-root
/// container to keep the row unary for the lazy stack.
struct TranscriptRow: View {
    @Environment(AppModel.self) private var app
    let item: TranscriptItem
    var showInlineReasoning = true
    var showMessageActions = true
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
                    showActions: showMessageActions,
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
    @ScaledMetric(relativeTo: .body) private var fontSize: CGFloat = 16

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            ForEach(item.attachments) { attachment in
                HStack {
                    Spacer(minLength: 56)
                    HStack(spacing: 10) {
                        Image(systemName: attachment.type == "image" ? "photo" : "doc")
                        VStack(alignment: .leading, spacing: 3) {
                            Text(attachment.name)
                                .lineLimit(2)
                            Text(ByteCountFormatter.string(fromByteCount: Int64(attachment.sizeBytes), countStyle: .file))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .font(.subheadline)
                    .padding(12)
                    .background(DS.Color.bubbleFill, in: .rect(cornerRadius: DS.Radius.bubble))
                    .accessibilityElement(children: .combine)
                }
            }
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
                    LongMessageView(text: item.text, alignment: .trailing, skills: item.skills)
                } else {
                    userText
                }
            }
        }
    }

    private var userText: some View {
        HStack {
            Spacer(minLength: 56)
            UserMessageText(text: item.text, skills: item.skills)
                .textSelection(.enabled)
                .font(.system(size: fontSize))
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

/// Sent skills retain the composer's blue building-blocks icon and label.
/// Only host-confirmed or locally selected skills are decorated; paths and
/// native slash commands remain ordinary text.
struct UserMessageText: View {
    let text: String
    var skills: [MessageSkill] = []
    @ScaledMetric(relativeTo: .body) private var iconSize: CGFloat = 18

    static func leadingSkill(in text: String, skills: [MessageSkill]) -> MessageSkill? {
        guard let prefix = text.first, prefix == "/" || prefix == "$" else { return nil }
        return skills.first { skill in
            let invocation = String(prefix) + skill.name
            return text.hasPrefix(invocation) && (text.count == invocation.count
                || text.dropFirst(invocation.count).first?.isWhitespace == true)
        }
    }

    var body: some View {
        if let skill = Self.leadingSkill(in: text, skills: skills) {
            let token = SkillMention.text(skill.command.skillLabel, iconSize: iconSize)
            Text("\(token)\(String(text.dropFirst(skill.name.count + 1)))")
                .accessibilityLabel(skill.command.skillLabel + String(text.dropFirst(skill.name.count + 1)))
        } else {
            Text(text)
        }
    }
}

private struct AssistantMessage: View {
    let item: TranscriptItem
    let showReasoning: Bool
    let showActions: Bool
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
            if showActions, !item.isStreaming, !item.text.isEmpty {
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
        !foldedActivityItems.isEmpty || (showReasoning && !item.reasoning.isEmpty)
    }

}

/// Coalesces rapid snapshots without holding back received text.
private struct StreamingAssistantText: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let text: String
    let isStreaming: Bool

    @State private var stream: StreamingReveal

    init(text: String, isStreaming: Bool) {
        self.text = text
        self.isStreaming = isStreaming
        _stream = State(initialValue: StreamingReveal(text: text))
    }

    var body: some View {
        MarkdownText(!isStreaming || reduceMotion ? text : stream.displayedText, isStreaming: isStreaming)
            .transaction { $0.animation = nil }
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

            // Text is already progress. Repeated fades and haptics make a
            // frequently updated reading surface harder to follow.
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { _ = stream.commit() }
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let item: TranscriptItem
    var foldedActivityItems: [TranscriptItem] = []
    var includeReasoning = true
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(reduceMotion ? nil : .snappy) { expanded.toggle() }
            } label: {
                HStack(spacing: 5) {
                    Text(headerText)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(DS.Color.fgSubtle)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)

            if !foldedActivityItems.isEmpty {
                Divider()
                    .padding(.bottom, 6)
            }

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
                    TurnWorkItem(item: activityItem, includeReasoning: includeReasoning)
                }
                if includeReasoning, !item.reasoning.isEmpty {
                    ExpandedThought(item: item)
                }
            }
            .padding(.leading, 6)
            .transition(.opacity)
        }
    }

    private var headerText: String {
        if !foldedActivityItems.isEmpty {
            return ToolActivityStrip.turnSummaryPhrase(for: foldedActivityItems + [item])
        }
        if let duration = item.reasoningDuration, duration >= 0.5 {
            return "Thought for \(Self.format(duration))"
        }
        return "Thoughts"
    }

    private var activityTimelineItems: [TranscriptItem] {
        foldedActivityItems.filter { activityItem in
            switch activityItem.kind {
            case .tool:
                return true
            case .assistant:
                return !activityItem.text.isEmpty || (includeReasoning && !activityItem.reasoning.isEmpty)
            case .agents, .user, .system, .error:
                return false
            }
        }
    }

    private static func format(_ seconds: Double) -> String {
        if seconds < 60 { return "\(max(1, Int(seconds.rounded())))s" }
        let minutes = Int(seconds / 60)
        let rest = Int(seconds) % 60
        return rest == 0 ? "\(minutes)m" : "\(minutes)m \(rest)s"
    }
}

/// The completed turn keeps narration and tool details in their original order.
private struct TurnWorkItem: View {
    let item: TranscriptItem
    let includeReasoning: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if item.kind == .tool {
                ToolCallCard(item: item)
            } else {
                if includeReasoning, !item.reasoning.isEmpty {
                    ExpandedThought(item: item)
                }
                if !item.text.isEmpty {
                    MarkdownText(String(item.text.prefix(TranscriptItem.maxRenderedChars)))
                }
            }
        }
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
    var skills: [MessageSkill] = []
    @State private var showingFull = false

    private static let previewLimit = 1_200

    private var frameAlignment: Alignment { alignment == .trailing ? .trailing : .leading }

    var body: some View {
        VStack(alignment: alignment, spacing: 8) {
            UserMessageText(text: String(text.prefix(Self.previewLimit)) + "…", skills: skills)
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
