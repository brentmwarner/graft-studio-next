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

            if let chat = boundChat {
                TranscriptView(chat: chat)
                    .id(chat.id)
            } else {
                ProgressView("Loading thread…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let chat = boundChat {
                // 12pt steps match the Codex reference: the diff pill floats
                // just above the composer instead of a full control-row away.
                VStack(spacing: 12) {
                    // Diff pill and the jump-to-latest arrow share one row so
                    // the two floating chips read as a single chrome band.
                    if !chat.pendingDiffs.isEmpty || chat.isAwayFromLatest {
                        HStack(spacing: 8) {
                            if !chat.pendingDiffs.isEmpty {
                                ComposerDiffBubbleStrip(
                                    diffs: chat.pendingDiffs,
                                    onOpenDiff: { diffId in
                                        Task { await chat.openDiff(id: diffId) }
                                    }
                                )
                            }
                            Spacer(minLength: 0)
                            if chat.isAwayFromLatest {
                                ScrollToBottomButton {
                                    chat.scrollToLatest()
                                }
                                .transition(.scale(scale: 0.6).combined(with: .opacity))
                            }
                        }
                        .padding(.horizontal, 12)
                        .animation(.snappy(duration: 0.25), value: chat.isAwayFromLatest)
                    }
                    if chat.needsInteraction {
                        InteractionBar(chat: chat)
                    }
                    ComposerView(chat: chat, siblingChromeHeight: 0)
                        .id(chat.id)
                }
                // No painted backdrop behind the bottom chrome — the glass
                // pieces float directly over the transcript, natively.
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingContextDetails = true
                } label: {
                    ContextProgressRing(usage: contextUsage)
                }
                .accessibilityLabel(contextAccessibilityLabel)
            }
        }
        .alert("Context", isPresented: $showingContextDetails) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(contextDetail)
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
                DiffSheet(diff: diff)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
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

    private var contextDetail: String {
        guard let contextUsage, contextUsage.source == "measured" else {
            return "This provider does not report context-window usage yet."
        }
        guard contextUsage.tokensMax > 0 else {
            return "\(contextUsage.percent)% of the context window is used."
        }
        return "\(contextUsage.percent)% used · \(Self.formatTokens(contextUsage.tokensUsed)) of \(Self.formatTokens(contextUsage.tokensMax)) tokens"
    }

    private static func formatTokens(_ tokens: Int) -> String {
        if tokens >= 1_000_000 {
            return String(format: "%.1fM", Double(tokens) / 1_000_000)
                .replacingOccurrences(of: ".0M", with: "M")
        }
        if tokens >= 1_000 {
            return String(format: "%.1fK", Double(tokens) / 1_000)
                .replacingOccurrences(of: ".0K", with: "K")
        }
        return String(tokens)
    }
}

private struct ContextProgressRing: View {
    let usage: ContextUsageInfo?

    private var isUnknown: Bool {
        usage?.source != "measured"
    }

    private var progress: CGFloat {
        CGFloat(min(100, max(0, usage?.percent ?? 0))) / 100
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(
                    Color.secondary.opacity(isUnknown ? 0.56 : 0.2),
                    style: StrokeStyle(
                        lineWidth: 2,
                        lineCap: .round,
                        dash: isUnknown ? [2.5, 3.5] : []
                    )
                )
            if !isUnknown {
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(
                        Color.secondary,
                        style: StrokeStyle(lineWidth: 2, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
            }
        }
        .frame(width: 22, height: 22)
    }
}

#Preview {
    NavigationStack {
        ThreadView(threadId: "thread-1", title: "Build native mobile app")
            .environment(AppModel())
    }
}
