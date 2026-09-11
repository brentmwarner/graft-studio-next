import SwiftUI

/// "Dispatch & Returns" — how delegated agents live in the transcript.
///
/// While the orchestrator's delegation runs, every child is a quiet workline
/// (queued → working → returned) sitting where the thinking header lives.
/// When the call settles, the lines collapse into a one-line receipt and the
/// returns land as swipeable cards; the orchestrator's synthesis follows as
/// its normal prose. Tapping a card zooms into the full-screen return.
struct AgentThreadsView: View {
    let item: TranscriptItem
    @State private var openTarget: ReturnTarget?
    @State private var receiptExpanded = false
    @Namespace private var zoom
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// What was tapped: the run plus which on-screen element should grow
    /// into the sheet — cards and worklines register distinct sources.
    private struct ReturnTarget: Identifiable {
        let run: AgentRun
        let source: String
        var id: String { source }
    }

    private var settled: Bool { item.agentsSettled && !item.agentRuns.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if item.agentRuns.isEmpty {
                SpawningRow()
            } else if settled {
                ReceiptRow(runs: item.agentRuns, expanded: receiptExpanded) {
                    // One explicit transaction so the chevron turn, the lines
                    // fading in, and the tray sliding down share one spring.
                    withAnimation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.8)) {
                        receiptExpanded.toggle()
                    }
                }
                if receiptExpanded {
                    // Blur-replace grows in place — a move(edge:) here slides
                    // the lines over the receipt and reads as jank.
                    worklines
                        .transition(reduceMotion ? AnyTransition.opacity : AnyTransition(.blurReplace))
                }
                ReturnsTray(runs: item.agentRuns, zoom: zoom) { run in
                    openTarget = ReturnTarget(run: run, source: "card-\(run.id)")
                }
            } else {
                worklines
            }
        }
        .animation(.smooth(duration: 0.35), value: settled)
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: item.agentRuns.count)
        // Resize as one unit: without this, children animate against the
        // still-moving row geometry and the expand looks like it stutters.
        .geometryGroup()
        // The return opens as a tall sheet, GROWING out of whatever was
        // tapped (zoom + detents compose). The transition must be the
        // unconditional root modifier of the presented content — a branch
        // around it silently downgrades to the default slide.
        .sheet(item: $openTarget) { target in
            AgentReturnPage(run: target.run)
                .navigationTransition(.zoom(sourceID: target.source, in: zoom))
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(DS.Color.bg)
        }
    }

    private var worklines: some View {
        VStack(alignment: .leading, spacing: 9) {
            ForEach(item.agentRuns) { run in
                AgentWorkline(run: run) {
                    openTarget = ReturnTarget(run: run, source: "line-\(run.id)")
                }
                .matchedTransitionSource(id: "line-\(run.id)", in: zoom)
                .transition(.opacity)
            }
        }
    }
}

/// The beat between "delegate" being called and the goals parsing out.
private struct SpawningRow: View {
    var body: some View {
        HStack(spacing: 8) {
            TypingDots()
            ShimmerText(text: "Delegating", font: .subheadline.weight(.medium))
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Worklines (the working state)

/// One agent as a single quiet line: who · what's happening · how long.
private struct AgentWorkline: View {
    let run: AgentRun
    let onOpen: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            AgentAvatar(persona: run.persona, size: 18)
                .opacity(run.status == .queued ? 0.45 : 1)
            Text(run.persona.name)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(run.status == .queued ? DS.Color.fgSubtle : DS.Color.fg)
            Text("·")
                .font(.footnote)
                .foregroundStyle(DS.Color.fgFaint)
            statusText
                .lineLimit(1)
            Spacer(minLength: 8)
            trailing
        }
        .contentShape(.rect)
        .onTapGesture(perform: onOpen)
        .accessibilityLabel(accessibilityText)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onOpen() }
    }

    @ViewBuilder
    private var statusText: some View {
        switch run.status {
        case .queued:
            Text(run.goal.isEmpty ? "queued" : run.goal)
                .font(DS.Font.footnote)
                .foregroundStyle(DS.Color.fgSubtle)
        case .working:
            ShimmerText(text: liveLine, font: .footnote)
        case .done:
            Text(run.resultPreview.isEmpty ? "returned" : run.resultPreview)
                .font(DS.Font.footnote)
                .foregroundStyle(DS.Color.fgSubtle)
        case .failed:
            Text(run.resultPreview.isEmpty ? "failed" : run.resultPreview)
                .font(DS.Font.footnote)
                .foregroundStyle(DS.Color.danger)
        }
    }

    @ViewBuilder
    private var trailing: some View {
        switch run.status {
        case .queued:
            Text("–")
                .font(.caption2)
                .foregroundStyle(DS.Color.fgFaint)
        case .working:
            if let interrupt = run.onInterrupt {
                Button(role: .destructive) {
                    interrupt()
                } label: {
                    Image(systemName: "stop.circle")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(DS.Color.danger)
                        .frame(width: 28, height: 28)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Stop this agent")
            } else {
                ProgressView()
                    .controlSize(.mini)
            }
        case .done:
            HStack(spacing: 3) {
                Image(systemName: "checkmark")
                    .font(.system(size: 9, weight: .semibold))
                if let text = RunFormat.duration(run.durationSeconds) {
                    Text(text).font(.caption2.weight(.medium))
                }
            }
            .foregroundStyle(DS.Color.fgSubtle)
        case .failed:
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(DS.Color.danger)
        }
    }

    /// What this agent is doing right now — the goal until activity arrives.
    private var liveLine: String {
        if let latest = run.activity.last?.text, !latest.isEmpty { return latest }
        return run.goal.isEmpty ? "working…" : run.goal
    }

    private var accessibilityText: String {
        let state = switch run.status {
        case .queued: "queued"
        case .working: "working"
        case .done: "returned"
        case .failed: "failed"
        }
        return "\(run.persona.name), \(state). \(run.goal)"
    }
}

// MARK: - Receipt (the settled collapse)

/// "✓ 3 agents · 1m 58s" — the whole dispatch, folded to one line. Tapping
/// re-expands the worklines for the per-agent breakdown.
private struct ReceiptRow: View {
    let runs: [AgentRun]
    let expanded: Bool
    let onToggle: () -> Void

    private var anyFailed: Bool { runs.contains { $0.status == .failed } }
    private var longest: Double? { runs.compactMap(\.durationSeconds).max() }

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 6) {
                Image(systemName: anyFailed ? "exclamationmark.triangle" : "checkmark")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(anyFailed ? DS.Color.danger : DS.Color.fg)
                Text(label)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(DS.Color.fgSubtle)
                Image(systemName: "chevron.right")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(DS.Color.fgFaint)
                    .rotationEffect(.degrees(expanded ? 90 : 0))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background {
                Capsule().strokeBorder(DS.Color.border, lineWidth: 1)
            }
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
    }

    private var label: String {
        var text = runs.count == 1 ? "1 agent" : "\(runs.count) agents"
        if let longest, let formatted = RunFormat.duration(longest) {
            text += " · \(formatted)"
        }
        return text
    }
}

// MARK: - Returns tray (the results arriving)

/// The agents' returns as swipeable cards — next card peeking, dots beneath.
/// A single return renders as one full-width card, no carousel ceremony.
private struct ReturnsTray: View {
    let runs: [AgentRun]
    let zoom: Namespace.ID
    let onOpen: (AgentRun) -> Void
    @State private var focusedID: String?

    var body: some View {
        if runs.count == 1 {
            card(runs[0])
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 10) {
                        ForEach(runs) { run in
                            card(run)
                                .containerRelativeFrame(.horizontal) { length, _ in
                                    length * 0.86
                                }
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.viewAligned)
                .scrollPosition(id: $focusedID)
                .scrollClipDisabled()
                dots
            }
        }
    }

    private func card(_ run: AgentRun) -> some View {
        Button {
            onOpen(run)
        } label: {
            AgentReturnCard(run: run)
        }
        .buttonStyle(PressableButtonStyle(scale: 0.98))
        .matchedTransitionSource(id: "card-\(run.id)", in: zoom)
    }

    private var dots: some View {
        let focusedIndex = runs.firstIndex { $0.id == focusedID } ?? 0
        return HStack(spacing: 5) {
            ForEach(Array(runs.enumerated()), id: \.element.id) { index, _ in
                Circle()
                    .fill(index == focusedIndex ? DS.Color.fg : DS.Color.border)
                    .frame(width: 5, height: 5)
            }
        }
        .frame(maxWidth: .infinity)
        .animation(.snappy(duration: 0.2), value: focusedID)
        .accessibilityHidden(true)
    }
}

/// One return: who came back, the heart of what they found, and the cost of
/// asking — sized for a glance, the full page is one tap away.
private struct AgentReturnCard: View {
    let run: AgentRun

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 7) {
                AgentAvatar(persona: run.persona, size: 18)
                Text(run.persona.name)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(DS.Color.fg)
                Spacer(minLength: 8)
                mark
            }
            Text(RunFormat.inlineMarkdown(run.summary.isEmpty ? run.goal : run.summary))
                .font(DS.Font.footnote)
                .foregroundStyle(DS.Color.fg)
                .lineLimit(4)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let stats = footerStats {
                Text(stats)
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Color.fgSubtle)
            }
        }
        .padding(13)
        .background(DS.Color.bgElevated, in: .rect(cornerRadius: DS.Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: DS.Radius.lg)
                .strokeBorder(
                    run.status == .failed ? DS.Color.danger.opacity(0.35) : DS.Color.border,
                    lineWidth: 1
                )
        }
        .contentShape(.rect(cornerRadius: DS.Radius.lg))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(run.persona.name) return. \(run.summary)")
    }

    @ViewBuilder
    private var mark: some View {
        switch run.status {
        case .failed:
            HStack(spacing: 3) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 9, weight: .semibold))
                Text("Failed").font(.caption2.weight(.medium))
            }
            .foregroundStyle(DS.Color.danger)
        default:
            HStack(spacing: 3) {
                Image(systemName: "checkmark")
                    .font(.system(size: 9, weight: .semibold))
                if let text = RunFormat.duration(run.durationSeconds) {
                    Text(text).font(.caption2.weight(.medium))
                }
            }
            .foregroundStyle(DS.Color.fgSubtle)
        }
    }

    private var footerStats: String? {
        var parts: [String] = []
        if run.toolCount > 0 { parts.append(run.toolCount == 1 ? "1 tool" : "\(run.toolCount) tools") }
        if let tokens = RunFormat.tokens(run.inputTokens, run.outputTokens) { parts.append(tokens) }
        if !run.model.isEmpty { parts.append(run.model) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

// MARK: - The full-screen return

/// A return, opened: the assignment, the full reply, how the agent actually
/// got there, what it touched, and the cost of asking. A working run shows
/// its live feed instead and can be stopped from here. The sheet's grabber
/// and swipe-down are the only dismissal — a ✕ doubled the chrome.
struct AgentReturnPage: View {
    let run: AgentRun
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.s3) {
                header
                if !run.summary.isEmpty {
                    MarkdownText(run.summary)
                } else if run.status == .working {
                    HStack(spacing: 8) {
                        TypingDots()
                        ShimmerText(text: "Working", font: .footnote)
                    }
                }
                if run.status == .working, !run.activity.isEmpty {
                    section("Live activity") {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(run.activity.suffix(12)) { entry in
                                Text(entry.text)
                                    .font(DS.Font.footnote)
                                    .foregroundStyle(DS.Color.fgSubtle)
                                    .lineLimit(2)
                            }
                        }
                    }
                }
                if !run.outputTail.isEmpty {
                    section("How it got there") {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(run.outputTail) { entry in
                                TailEntryCard(entry: entry)
                            }
                        }
                    }
                }
                filesSection
                if let receipt = receiptLine {
                    Text(receipt)
                        .font(DS.Font.caption)
                        .foregroundStyle(DS.Color.fgSubtle)
                        .padding(.top, 2)
                }
                if run.status == .working, let interrupt = run.onInterrupt {
                    Button(role: .destructive) {
                        interrupt()
                        dismiss()
                    } label: {
                        Label("Stop this agent", systemImage: "stop.circle")
                            .font(DS.Font.subhead)
                            .foregroundStyle(DS.Color.danger)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(DS.Color.bgSubtle, in: .capsule)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
            // Clears the grabber — there's no nav bar inset to do it anymore.
            .padding(.top, 24)
            .padding(.bottom, 40)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(DS.Color.bg)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("RETURN · \(run.persona.name.uppercased())")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(DS.Color.fgSubtle)
                .tracking(0.8)
            if !run.goal.isEmpty {
                Text(run.goal)
                    .font(DS.Font.title3)
                    .foregroundStyle(DS.Color.fg)
                    .lineLimit(3)
            }
            HStack(spacing: 6) {
                AgentAvatar(persona: run.persona, working: run.status == .working, size: 18)
                Text(byline)
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Color.fgSubtle)
            }
            .padding(.top, 3)
        }
        .padding(.top, 4)
    }

    private var byline: String {
        var parts: [String] = []
        switch run.status {
        case .queued: parts.append("queued")
        case .working: parts.append("working")
        case .done:
            if let text = RunFormat.duration(run.durationSeconds) {
                parts.append("✓ \(text)")
            } else {
                parts.append("✓ returned")
            }
        case .failed: parts.append("failed")
        }
        if !run.model.isEmpty { parts.append(run.model) }
        if run.toolCount > 0 { parts.append(run.toolCount == 1 ? "1 tool" : "\(run.toolCount) tools") }
        if let tokens = RunFormat.tokens(run.inputTokens, run.outputTokens) { parts.append(tokens) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var filesSection: some View {
        let files = run.filesWritten.isEmpty ? run.filesRead : run.filesWritten
        if !files.isEmpty {
            section(run.filesWritten.isEmpty ? "Files read" : "Files written") {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(files.prefix(6), id: \.self) { path in
                        Text((path as NSString).lastPathComponent)
                            .font(.caption.monospaced())
                            .foregroundStyle(DS.Color.fgMuted)
                            .lineLimit(1)
                    }
                    if files.count > 6 {
                        Text("+\(files.count - 6) more")
                            .font(DS.Font.caption)
                            .foregroundStyle(DS.Color.fgSubtle)
                    }
                }
            }
        }
    }

    private var receiptLine: String? {
        var parts: [String] = []
        if let calls = run.apiCalls, calls > 0 {
            parts.append(calls == 1 ? "1 API call" : "\(calls) API calls")
        }
        if let cost = run.costUSD, cost > 0 { parts.append(String(format: "$%.2f", cost)) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func section(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(DS.Color.fgSubtle)
                .tracking(0.5)
            content()
        }
    }
}

/// One tool result from the agent's transcript tail — name plus a clipped
/// monospaced preview; errors carry the danger tint on the name.
private struct TailEntryCard: View {
    let entry: AgentTailEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                Image(systemName: ToolPresentation(name: entry.tool, context: "").symbol)
                    .font(.caption2.weight(.medium))
                Text(entry.tool)
                    .font(.caption.weight(.medium))
            }
            .foregroundStyle(entry.isError ? DS.Color.danger : DS.Color.fgSubtle)
            if !entry.preview.isEmpty {
                Text(entry.preview)
                    .font(.caption.monospaced())
                    .foregroundStyle(DS.Color.fgMuted)
                    .lineLimit(5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(DS.Color.bgSubtle, in: .rect(cornerRadius: DS.Radius.sm))
            }
        }
    }
}

// MARK: - Shared atoms

/// Monogram avatar — the agent's face. Solid accent circle (the send-button
/// idiom: an entity, not chrome) with a soft pulse ring while working.
struct AgentAvatar: View {
    let persona: AgentPersona
    var working = false
    var size: CGFloat = 32

    @State private var pulsing = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            if working, !reduceMotion {
                Circle()
                    .stroke(DS.Color.fg.opacity(0.25), lineWidth: 1.5)
                    .scaleEffect(pulsing ? 1.45 : 1.0)
                    .opacity(pulsing ? 0 : 0.8)
                    .animation(
                        .easeOut(duration: 1.6).repeatForever(autoreverses: false),
                        value: pulsing
                    )
            }
            Circle()
                .fill(DS.Color.accent)
            Text(persona.monogram)
                .font(.system(size: size * 0.42, weight: .semibold))
                .foregroundStyle(DS.Color.accentFg)
        }
        .frame(width: size, height: size)
        .onAppear { pulsing = working }
        .onChange(of: working) { _, active in pulsing = active }
    }
}

/// iMessage-register typing indicator: three dots breathing in sequence.
struct TypingDots: View {
    @State private var animating = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 3.5) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(DS.Color.fgSubtle)
                    .frame(width: 5, height: 5)
                    .opacity(animating && !reduceMotion ? 1 : 0.4)
                    .scaleEffect(animating && !reduceMotion ? 1.0 : 0.82)
                    .animation(
                        reduceMotion
                            ? nil
                            : .easeInOut(duration: 0.5)
                                .repeatForever(autoreverses: true)
                                .delay(Double(index) * 0.16),
                        value: animating
                    )
            }
        }
        .onAppear { animating = true }
        .accessibilityHidden(true)
    }
}

/// Formatting shared by the workline, card, and page surfaces.
enum RunFormat {
    static func duration(_ seconds: Double?) -> String? {
        guard let seconds, seconds >= 0.5 else { return nil }
        if seconds < 60 { return "\(max(1, Int(seconds.rounded())))s" }
        let minutes = Int(seconds / 60)
        let rest = Int(seconds) % 60
        return rest == 0 ? "\(minutes)m" : "\(minutes)m \(rest)s"
    }

    static func tokens(_ input: Int?, _ output: Int?) -> String? {
        let total = (input ?? 0) + (output ?? 0)
        guard total > 0 else { return nil }
        if total < 1000 { return "\(total) tokens" }
        return String(format: "%.1fk tokens", Double(total) / 1000)
    }

    /// Inline-only markdown (bold, italics, code) with line structure kept —
    /// block syntax stays literal, which is right for a clipped preview.
    static func inlineMarkdown(_ text: String) -> AttributedString {
        (try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(text)
    }
}
