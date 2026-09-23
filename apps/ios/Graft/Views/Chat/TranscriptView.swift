import SwiftUI

/// Follows live response text until the user scrolls away.
struct TranscriptView: View {
    let chat: ChatModel
    /// Edge-based scroll control. Opens at the bottom and re-pins by EDGE (not by
    /// a view id), which reliably reaches the true bottom of a tall lazy list.
    @State private var scrollPosition = ScrollPosition(edge: .bottom)
    @State private var isAwayFromBottom = false
    @State private var followScrollTask: Task<Void, Never>?
    /// Live distance from the bottom edge (points) and whether the user is
    /// physically scrolling. Together they let us arm `isAwayFromBottom` ONLY on
    /// a deliberate user drag — never on programmatic streaming growth.
    @State private var distanceFromBottom: CGFloat = 0
    @State private var userInteracting = false
    @State private var cachedGroupedRows: [TranscriptRowGroup] = []
    @State private var cachedGroupingSignature = TranscriptGroupingSignature()
    #if DEBUG
    /// Diagnostic mirror of the scroll view's bottom content inset (safe area +
    /// keyboard), surfaced in the `--stream-sim` overlay. The keyboard re-pin
    /// reads the live `old`/`new` from the geometry change, not this.
    @State private var bottomInset: CGFloat = 0
    #endif
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let nearBottomDistance: CGFloat = 24
    private static let awayDistance: CGFloat = 64

    /// Live rows stay in order; settled turns fold behind their final answer.
    private var groupingSignature: TranscriptGroupingSignature {
        TranscriptGroupingSignature(
            itemCount: chat.items.count,
            isTurnActive: chat.isTurnActive,
            tail: chat.items.suffix(8).map {
                TranscriptGroupingKey(
                    id: $0.id,
                    isSessionNotice: $0.isSessionNotice,
                    isActivityItem: Self.isActivityItem($0),
                    isStreaming: $0.isStreaming,
                    hasReasoning: !$0.reasoning.isEmpty,
                    hasText: !$0.text.isEmpty,
                    toolStatus: Self.toolStatusSignature($0.toolStatus)
                )
            }
        )
    }

    private var displayedGroupedRows: [TranscriptRowGroup] {
        cachedGroupingSignature == groupingSignature ? cachedGroupedRows : Self.groupRows(chat.items, isTurnActive: chat.isTurnActive)
    }

    private static func groupRows(_ items: [TranscriptItem], isTurnActive: Bool = false) -> [TranscriptRowGroup] {
        var result: [TranscriptRowGroup] = []
        var pendingActivity: [TranscriptItem] = []
        var finalAssistantIndex: Int?
        var turnStart = 0

        func finishTurn(showActions: Bool) {
            if let index = finalAssistantIndex {
                result[index].showMessageActions = showActions
                if showActions {
                    let foldIndices = (turnStart..<result.count).filter { candidate in
                        candidate != index && result[candidate].items.allSatisfy {
                            $0.kind == .assistant || $0.kind == .tool
                        }
                    }
                    result[index].foldedActivityItems = foldIndices.flatMap { result[$0].items }
                    for candidate in foldIndices.reversed() { result.remove(at: candidate) }
                }
            }
            finalAssistantIndex = nil
            turnStart = result.count
        }

        func flushPendingActivity() {
            guard !pendingActivity.isEmpty else { return }
            result.append(TranscriptRowGroup(id: pendingActivity[0].id, items: pendingActivity))
            pendingActivity.removeAll(keepingCapacity: true)
        }

        for item in items {
            // Hermes' startup config banner / lifecycle notices never get a row.
            if item.isSessionNotice { continue }
            if item.kind == .user {
                flushPendingActivity()
                finishTurn(showActions: true)
            }
            let isActivity = Self.isActivityItem(item)

            if isActivity {
                pendingActivity.append(item)
                continue
            }

            // Preserve live row identity; only completion folds the work.
            flushPendingActivity()
            result.append(TranscriptRowGroup(id: item.id, items: [item]))
            if item.kind == .user { turnStart = result.count }
            if item.kind == .assistant, !item.text.isEmpty {
                finalAssistantIndex = result.count - 1
            }
        }
        flushPendingActivity()
        finishTurn(showActions: !isTurnActive)
        return result
    }

    #if DEBUG
    static func debugGroupedRowCounts(_ items: [TranscriptItem]) -> [Int] {
        groupRows(items).map { $0.items.count + $0.foldedActivityItems.count }
    }

    static func debugGroupedRowActivityFlags(_ items: [TranscriptItem]) -> [Bool] {
        groupRows(items).map(\.isToolGroup)
    }

    static func debugGroupedRowInlineReasoningFlags(_ items: [TranscriptItem]) -> [Bool] {
        groupRows(items).map(\.showInlineReasoning)
    }

    static func debugGroupedRowFoldedActivityCounts(_ items: [TranscriptItem]) -> [Int] {
        groupRows(items).map(\.foldedActivityItems.count)
    }

    static func debugGroupedRowActionFlags(_ items: [TranscriptItem], isTurnActive: Bool) -> [Bool] {
        groupRows(items, isTurnActive: isTurnActive).map(\.showMessageActions)
    }
    #endif

    /// Belongs in the turn's activity timeline: a tool call, or an assistant
    /// segment that is pure thinking (no visible reply text). The moment a
    /// streaming segment produces text it leaves the timeline and becomes
    /// the reply row.
    static func isActivityItem(_ item: TranscriptItem) -> Bool {
        item.isActivityTimelineItem
    }

    /// Read user metadata only, so incoming assistant text does not rebuild
    /// the context. Restored history and optimistic messages use the same path.
    static func referencedSkills(in items: [TranscriptItem]) -> [MessageSkill] {
        var skills: [String: MessageSkill] = [:]
        for item in items where item.kind == .user {
            for skill in item.skills {
                skills[skill.name] = MessageSkill(name: skill.name,
                    displayName: skill.displayName ?? skills[skill.name]?.displayName)
            }
        }
        return skills.values.sorted { $0.name < $1.name }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                if chat.isLoadingHistory {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                }
                ForEach(displayedGroupedRows) { row in
                    VStack(alignment: .leading, spacing: 0) {
                        if row.isToolGroup {
                            ToolActivityStrip(items: row.items)
                        } else {
                            TranscriptRow(
                                item: row.items[0],
                                showInlineReasoning: row.showInlineReasoning,
                                showMessageActions: row.showMessageActions,
                                foldedActivityItems: row.foldedActivityItems
                            )
                        }
                    }
                }
                StreamingFooter(chat: chat)
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            // Give the live indicator a little breathing room above the
            // floating controls without changing the completed transcript.
            .padding(.bottom, chat.liveStatusText == nil ? 2 : 10)
        }
        .environment(\.transcriptSkills, Self.referencedSkills(in: chat.items))
        .environment(\.transcriptConnectionActive, chat.app == nil || chat.app?.gateway.state == .connected)
        .scrollEdgeEffectStyle(.soft, for: .bottom)
        .modifier(StreamingFeedback(chat: chat, isFollowing: !isAwayFromBottom && !userInteracting))
        // Open at the latest message by anchoring ONLY the initial content offset to
        // the bottom. `scrollPosition.scrollTo(edge: .bottom)` computes the bottom from
        // the LazyVStack's *estimated* height, so when the last row is un-realized
        // (fresh open from history) the estimate is short and the scroll lands in dead
        // space — a blank viewport until a drag forces realization (FET-14). Anchoring
        // `.initialOffset` makes the bottom the resting point during the FIRST layout
        // pass, which realizes the tall tail at its true bottom edge.
        //
        // Scope to `.initialOffset` only. A blanket `.defaultScrollAnchor(.bottom)`
        // also bottom-anchors the other two roles, which regress real UX:
        //   • `.alignment` shoves SHORT transcripts to the bottom with an empty gap
        //     above (content "pushed down").
        //   • `.sizeChanges` re-anchors on every content-size change and fights
        //     `scrollPosition`'s own follow logic, surfacing stale rows that only
        //     reconcile on scroll (an old response that "flickers" to the current one).
        // Leaving those at their defaults keeps short content top-aligned and lets
        // `scrollPosition` own streaming-follow.
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        // `ScrollPosition(edge: .bottom)` opens at the latest message and keeps the
        // bottom pinned as content streams in — but only while we're AT the bottom;
        // the moment the user scrolls up it reflects their offset and stops
        // following, so it never fights a deliberate scroll. Re-pinning by EDGE
        // (vs a `scrollTo` to a 1pt anchor far down an un-realized `LazyVStack`,
        // which lands short or not at all) is what makes the jump button reliable.
        .scrollPosition($scrollPosition)
        .accessibilityIdentifier("chat-transcript")
        .dismissKeyboardOnTap()
        .scrollDismissesKeyboard(.interactively)
        .scrollEdgeEffectStyle(.soft, for: .all)
        .onScrollPhaseChange { _, phase in
            // A real finger-driven scroll (drag or its fling) is the only thing
            // allowed to arm "away" (see the geometry handler), and while it's
            // happening we pause the streaming auto-scroll so it isn't fought.
            userInteracting = phase == .interacting
                || phase == .decelerating
                || phase == .tracking
        }
        .onScrollGeometryChange(for: CGFloat.self) { geo in
            // Distance from the bottom edge, in points. `visibleRect` tracks the
            // real viewport after SwiftUI applies safe-area/content insets, which
            // keeps the latch honest under the floating chat chrome.
            max(0, geo.contentSize.height - geo.visibleRect.maxY)
        } action: { _, distance in
            distanceFromBottom = distance
            if distance <= Self.nearBottomDistance {
                // Back at the bottom (a jump, a send re-pinning, or scrolling down):
                // hide the button and resume following, however we got here.
                if isAwayFromBottom {
                    withAnimation(.snappy(duration: 0.25)) { isAwayFromBottom = false }
                }
            } else if userInteracting, distance > Self.awayDistance, !isAwayFromBottom {
                // The user is actively scrolling and has pulled meaningfully off the
                // bottom — surface the jump button RIGHT AWAY, not when the fling
                // finally settles. Programmatic streaming growth happens while
                // `userInteracting` is false, so it can't trip this.
                withAnimation(.snappy(duration: 0.25)) { isAwayFromBottom = true }
            }
        }
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentInsets.bottom } action: { old, new in
            // The bottom inset grew — almost always the keyboard rising as the
            // composer gains focus (it also covers any other bottom-chrome
            // growth). Because `.scrollPosition` takes manual control, SwiftUI's
            // automatic keyboard offset is suppressed and the latch's three
            // triggers (content / send / streaming) don't fire here — so without
            // this the newest message stays put and the keyboard slides over it.
            // Re-pin to the bottom edge (now measured ABOVE the keyboard) while
            // we're following, matching the ChatGPT-register "content above the
            // composer" behavior. A deliberate scroll-up (away latch armed, or a
            // live drag) is preserved — we never yank the user back down.
            #if DEBUG
            bottomInset = new  // surfaced only in the --stream-sim overlay below
            #endif
            guard new > old + 1, !isAwayFromBottom, !userInteracting else { return }
            scrollPosition.scrollTo(edge: .bottom)
        }
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentSize.height } action: { old, new in
            // Preserve ChatGPT-style bottom follow for late rendered-height
            // changes (media decode, link previews, generated cards), but route
            // it through the coalescer so the geometry update cannot recursively
            // request layout work on every intermediate height tick.
            guard new > old + 1, hasLiveText, !isAwayFromBottom, !userInteracting else { return }
            requestFollowScroll()
        }
        // The jump affordance renders in the bottom chrome (ThreadView), on the
        // same row as the diff pill; the transcript only publishes the latch.
        .onChange(of: isAwayFromBottom) { _, away in
            chat.isAwayFromLatest = away
        }
        .onChange(of: chat.scrollToLatestTick) {
            jumpToBottom()
        }
        #if DEBUG
        .overlay(alignment: .topLeading) {
            if CommandLine.arguments.contains("--stream-sim") {
                Text(String(format: "d=%.0f ins=%.0f away=%@ drag=%@ str=%@ n=%d",
                            distanceFromBottom,
                            bottomInset,
                            isAwayFromBottom ? "Y" : "N",
                            userInteracting ? "Y" : "N",
                            chat.isStreaming ? "Y" : "N",
                            chat.items.count))
                    .font(.caption2.monospaced().weight(.bold))
                    .padding(5)
                    .background(.black.opacity(0.78), in: .rect(cornerRadius: 6))
                    .foregroundStyle(.green)
                    .padding(.leading, 8).padding(.top, 150)
                    .allowsHitTesting(false)
            }
        }
        #endif
        .onChange(of: chat.sendTick) {
            // The user's own send: jump to the bottom and follow the new turn.
            jumpToBottom()
        }
        .onAppear {
            refreshGroupedRows(force: true)
        }
        .onChange(of: groupingSignature) {
            refreshGroupedRows()
        }
        .onChange(of: followSignal) {
            // Only user/assistant message changes request follow.
            requestFollowScroll()
        }
        .onDisappear {
            followScrollTask?.cancel()
            followScrollTask = nil
        }
    }

    private func jumpToBottom() {
        isAwayFromBottom = false
        userInteracting = false
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.28)) {
            scrollPosition.scrollTo(edge: .bottom)
        }
    }

    private func requestFollowScroll() {
        guard !isAwayFromBottom, !userInteracting else { return }
        followScrollTask?.cancel()
        followScrollTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(45))
            guard !Task.isCancelled, !isAwayFromBottom, !userInteracting else { return }
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                scrollPosition.scrollTo(edge: .bottom)
            }
        }
    }

    private func refreshGroupedRows(force: Bool = false) {
        let signature = groupingSignature
        guard force || signature != cachedGroupingSignature else { return }
        cachedGroupedRows = Self.groupRows(chat.items, isTurnActive: chat.isTurnActive)
        cachedGroupingSignature = signature
    }

    /// Tail-only render-height signal for auto-following the transcript bottom.
    /// The previous implementation hashed every row and every agent field, which
    /// made one streamed token invalidate this whole scroll container and queue a
    /// scroll. Track the active tail instead, and bucket text growth so we follow
    /// line-height changes without issuing a scroll request for every token.
    private var hasLiveText: Bool {
        guard chat.isStreaming, !chat.needsInteraction,
              chat.app?.gateway.state == .connected,
              let tail = chat.items.last else { return false }
        return tail.kind == .assistant && tail.isStreaming && !tail.text.isEmpty
    }

    private var followSignal: TranscriptFollowSignal {
        let messages = chat.items.filter { $0.kind == .user || ($0.kind == .assistant && !$0.text.isEmpty) }
        return TranscriptFollowSignal(
            isLoadingHistory: chat.isLoadingHistory,
            itemCount: messages.count,
            tailID: messages.last?.id,
            tailTextBucket: messages.last.map { textBucket($0.text.count) } ?? 0
        )
    }

    private func textBucket(_ count: Int) -> Int {
        count == 0 ? 0 : ((count - 1) / 24) + 1
    }

    private static func toolStatusSignature(_ status: ToolRunStatus) -> Int {
        switch status {
        case .running: 0
        case .done: 1
        case .failed: 2
        }
    }


}

private struct TranscriptFollowSignal: Equatable {
    var isLoadingHistory = false
    var itemCount = 0
    var tailID: UUID?
    var tailTextBucket = 0
}

private struct TranscriptGroupingSignature: Equatable {
    var itemCount = 0
    var isTurnActive = false
    var tail: [TranscriptGroupingKey] = []
}

private struct TranscriptGroupingKey: Equatable {
    var id: UUID
    var isSessionNotice: Bool
    var isActivityItem: Bool
    var isStreaming: Bool
    var hasReasoning: Bool
    var hasText: Bool
    var toolStatus: Int
}

private struct TranscriptRowGroup: Identifiable {
    let id: UUID
    var items: [TranscriptItem]
    var showInlineReasoning = true
    var showMessageActions = false
    var foldedActivityItems: [TranscriptItem] = []
    var isToolGroup: Bool {
        items.first.map(TranscriptView.isActivityItem) ?? false
    }
}

/// Glass "jump to latest" affordance shown when the user scrolls up.
/// Shares the diff row, clearing task controls without reserving transcript space.
struct ScrollToBottomButton: View {
    let action: () -> Void

    var body: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            action()
        } label: {
            Image(systemName: "arrow.down")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.primary)
                .frame(width: 44, height: 44)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        .accessibilityLabel("Scroll to latest message")
        .accessibilityIdentifier("scroll-to-latest")
    }
}

/// One stable live status throughout text, reasoning, and tool transitions.
private struct StreamingFooter: View {
    let chat: ChatModel
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let status = chat.liveStatusText {
                HStack(spacing: 10) {
                    if !chat.needsInteraction, chat.app?.gateway.state == .connected {
                        RunStatusDotMatrixLoader(size: 18, tint: DS.Color.fgSubtle)
                            .accessibilityIdentifier("chat-live-loader")
                    }
                    if !chat.needsInteraction, chat.app?.gateway.state == .connected {
                        ShimmerText(text: status, font: .subheadline)
                    } else {
                        Text(status).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("chat-live-status")
            }
            if let error = chat.lastError {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.caption).foregroundStyle(.red)
            }
        }
        .frame(minHeight: 24, alignment: .leading)
    }
}

/// Cached work retains its last-known status without animating while its computer is offline.
extension EnvironmentValues {
    @Entry var transcriptConnectionActive = true
}
