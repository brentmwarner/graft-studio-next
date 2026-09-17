import Foundation
import SwiftUI

/// Focused remote thread: transcript, interaction prompts, diff accessories,
/// and the glass composer. `AppModel` owns the `ChatModel` lifecycle.
struct ThreadView: View {
    @Environment(AppModel.self) private var app
    @State private var showingContextDetails = false

    let threadId: String
    let title: String

    var body: some View {
        ZStack {
            DS.Color.bg.ignoresSafeArea()

            Group {
                if let chat = boundChat {
                    TranscriptView(chat: chat)
                        .modifier(WorkspaceFilePresenter(links: chat.fileLinks))
                        .id(chat.id)
                } else {
                    ProgressView("Loading thread…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .readableChatColumn()
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let chat = boundChat {
                ThreadComposerDock(chat: chat)
                    .id(chat.id)
                    .readableChatColumn()
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .accessibilityAddTraits(.isHeader)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingContextDetails = true
                } label: {
                    ContextProgressRing(usage: contextUsage)
                }
                .accessibilityLabel(contextAccessibilityLabel)
                .popover(isPresented: $showingContextDetails) {
                    ThreadUsagePopover(threadId: threadId, fallbackContext: contextUsage)
                        .presentationCompactAdaptation(.popover)
                }
            }
        }
        .task(id: threadId) {
            await app.openThread(threadId, title: title)
        }
        .onDisappear {
            app.closeThread(threadId)
        }
        .sheet(
            isPresented: Binding(
                get: { boundChat?.openedDiff != nil },
                set: { if !$0 { boundChat?.dismissOpenedDiff() } }
            )
        ) {
            if let diff = boundChat?.openedDiff {
                DiffSheet(diff: diff) { path in
                    await app.fetchDiff(diffId: diff.id, filePath: path)
                }
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
                    .presentationBackgroundInteraction(.disabled)
                    .presentationCornerRadius(DS.Radius.xl)
            }
        }
    }

    private var boundChat: ChatModel? {
        guard let chat = app.activeChat, chat.threadId == threadId else { return nil }
        return chat
    }

    private var contextUsage: ContextUsageInfo? {
        app.snapshot?.threads.first { $0.id == threadId }?.contextUsage
    }

    private var contextAccessibilityLabel: String {
        guard let contextUsage, contextUsage.source == "measured" else {
            return "Context usage unavailable"
        }
        return "Context: \(contextUsage.percent)% used"
    }


}

/// Only the composer and its compact accessories reserve transcript space.
/// Menus and the jump button grow into an overlay above those stable bounds.
struct ThreadComposerDock: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var tasksExpanded = false
    @State private var slashVisible = false
    let chat: ChatModel

    private var hasAccessories: Bool {
        chat.taskProgress != nil || !chat.pendingDiffs.isEmpty
    }

    var body: some View {
        VStack(spacing: 12) {
            if hasAccessories {
                GlassEffectContainer(spacing: 12) {
                    HStack(spacing: 12) {
                        ComposerDiffBubbleStrip(diffs: chat.pendingDiffs) { diffId in
                            tasksExpanded = false
                            Task { await chat.openDiff(id: diffId) }
                        }
                        Spacer(minLength: 0)
                        if let progress = chat.taskProgress {
                            TaskProgressPill(progress: progress, expanded: tasksExpanded) {
                                withAnimation(reduceMotion ? nil : .smooth(duration: 0.24)) {
                                    tasksExpanded.toggle()
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 12)
                .opacity(slashVisible ? 0 : 1)
                .allowsHitTesting(!slashVisible)
                .accessibilityHidden(slashVisible)
                .accessibilityIdentifier("composer-accessory-row")
            }
            if chat.needsInteraction {
                InteractionBar(chat: chat)
            }
            ComposerView(chat: chat, siblingChromeHeight: hasAccessories ? 56 : 0, onSlashVisibilityChange: { visible in
                slashVisible = visible
                if visible { tasksExpanded = false }
            })
            .zIndex(2)
        }
        .overlay(alignment: .top) {
            VStack(spacing: 12) {
                if tasksExpanded, let progress = chat.taskProgress, !slashVisible {
                    TaskProgressDetails(progress: progress)
                        .transition(reduceMotion ? .opacity : .scale(scale: 0.97, anchor: .bottomTrailing).combined(with: .opacity))
                } else if chat.isAwayFromLatest, !slashVisible {
                    ScrollToBottomButton { chat.scrollToLatest() }
                        .transition(reduceMotion ? .opacity : .scale(scale: 0.9).combined(with: .opacity))
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 12)
            .alignmentGuide(.top) { $0[.bottom] }
        }
        .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: chat.isAwayFromLatest)
        .onChange(of: chat.taskProgress == nil) { _, isEmpty in
            if isEmpty { tasksExpanded = false }
        }
    }
}

private struct ContextProgressRing: View {
    let usage: ContextUsageInfo?

    var body: some View {
        UsageProgressRing(percent: usage?.source == "measured" ? Double(usage?.percent ?? 0) : nil)
    }
}

private struct UsageProgressRing: View {
    let percent: Double?
    var size: CGFloat = 20

    var body: some View {
        let lineWidth: CGFloat = size > 24 ? 3 : 2
        ZStack {
            Circle()
                .stroke(Color.secondary.opacity(percent == nil ? 0.56 : 0.2), lineWidth: lineWidth)
            if let percent {
                Circle()
                    .trim(from: 0, to: CGFloat(min(100, max(0, percent)) / 100))
                    .stroke(Color.secondary, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

#Preview {
    NavigationStack {
        ThreadView(threadId: "thread-1", title: "Build native mobile app")
            .environment(AppModel())
    }
}


private struct ThreadUsagePopover: View {
    @Environment(AppModel.self) private var app
    @State private var usage: ThreadUsageInfo?
    @State private var loading = true
    @State private var failed = false
    @State private var reload = 0
    let threadId: String
    let fallbackContext: ContextUsageInfo?

    private var context: ContextUsageInfo? {
        if let usage { return usage.contextUsage }
        return fallbackContext
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let context, context.source == "measured" {
                    meter("Context window", value: "\(context.percent)% used", percent: Double(context.percent))
                    if context.tokensMax > 0 {
                        Text("\(context.tokensUsed.formatted(.number.notation(.compactName))) of \(context.tokensMax.formatted(.number.notation(.compactName))) tokens")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    Text("Context window").font(.caption).foregroundStyle(.secondary)
                    Text("Not reported").font(.subheadline.weight(.semibold))
                }
                Divider()
                Text("Account usage").font(.caption).foregroundStyle(.secondary)
                if loading {
                    Text("Checking allowance…").font(.caption).foregroundStyle(.secondary)
                } else if let allowance = usage?.allowance {
                    if let plan = allowance.planName { Text(plan).font(.caption) }
                    ForEach(Array(allowance.limits.enumerated()), id: \.offset) { _, limit in
                        VStack(alignment: .leading, spacing: 6) {
                            meter(limit.label == "5h" ? "5-hour limit" : limit.label,
                                  value: "\(Int(limit.remainingPercent.rounded()))% remaining", percent: limit.remainingPercent)
                            if let reset = limit.resetsAt, let date = parseDate(reset) {
                                if date > .now {
                                    Text("Resets \(date.formatted(.dateTime.weekday(.abbreviated).hour().minute()))")
                                        .font(.caption).foregroundStyle(.secondary)
                                } else {
                                    Text("Awaiting updated allowance").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    if allowance.stale {
                        Text("Last reported allowance · may be out of date").font(.caption).foregroundStyle(.secondary)
                    }
                    if allowance.limits.isEmpty {
                        Text(allowance.status == "needs-auth"
                             ? "Sign in to the provider on your host to see allowance."
                             : "Account allowance is unavailable from this provider.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } else if failed {
                    Text("Account usage isn’t available right now.").font(.caption).foregroundStyle(.secondary)
                    Button("Try again") { reload += 1 }
                }
            }
            .padding(18)
        }
        .frame(width: 280, height: 380)
        .task(id: reload) {
            loading = true
            failed = false
            do {
                guard let rest = app.rest else { loading = false; failed = true; return }
                let result = try await rest.usage(threadId: threadId)
                try Task.checkCancellation()
                usage = result
                loading = false
            } catch {
                if !Task.isCancelled { failed = true; loading = false }
            }
        }
    }

    private func meter(_ title: String, value: String, percent: Double) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Text(title).font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Text(value).font(.subheadline.weight(.semibold))
                    .multilineTextAlignment(.trailing)
            }
            ProgressView(value: min(100, max(0, percent)), total: 100)
                .progressViewStyle(.linear)
                .tint(.secondary)
                .accessibilityHidden(true)
        }
    }

    private func parseDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
