import SwiftUI

/// The scrolling conversation surface. Pins to the bottom while streaming;
/// new items animate in.
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

    private static let nearBottomDistance: CGFloat = 56
    private static let awayDistance: CGFloat = 180

    /// Live working steps — tool calls AND the reasoning-only segments
    /// interleaved between them — stay in one activity timeline. Once those
    /// steps settle and an assistant reply follows, the activity folds into
    /// that reply's reasoning/work block instead of keeping a separate row.
    private var groupingSignature: TranscriptGroupingSignature {
        TranscriptGroupingSignature(
            itemCount: chat.items.count,
            tail: chat.items.suffix(8).map {
                TranscriptGroupingKey(
                    id: $0.id,
                    isSessionNotice: $0.isSessionNotice,
                    isActivityItem: Self.isActivityItem($0),
                    isStreaming: $0.isStreaming,
                    hasReasoning: !$0.reasoning.isEmpty,
                    toolStatus: Self.toolStatusSignature($0.toolStatus)
                )
            }
        )
    }

    private var displayedGroupedRows: [TranscriptRowGroup] {
        cachedGroupingSignature == groupingSignature ? cachedGroupedRows : Self.groupRows(chat.items)
    }

    private static func groupRows(_ items: [TranscriptItem]) -> [TranscriptRowGroup] {
        var result: [TranscriptRowGroup] = []
        var pendingActivity: [TranscriptItem] = []

        func flushPendingActivity() {
            guard !pendingActivity.isEmpty else { return }
            result.append(TranscriptRowGroup(id: pendingActivity[0].id, items: pendingActivity))
            pendingActivity.removeAll(keepingCapacity: true)
        }

        for item in items {
            // Hermes' startup config banner / lifecycle notices never get a row.
            if item.isSessionNotice { continue }
            let isActivity = Self.isActivityItem(item)

            if isActivity {
                pendingActivity.append(item)
                continue
            }

            if Self.canFoldPendingActivity(pendingActivity, into: item) {
                result.append(TranscriptRowGroup(
                    id: item.id,
                    items: [item],
                    showInlineReasoning: true,
                    foldedActivityItems: pendingActivity
                ))
                pendingActivity.removeAll(keepingCapacity: true)
            } else {
                flushPendingActivity()
                result.append(TranscriptRowGroup(id: item.id, items: [item]))
            }
        }
        flushPendingActivity()
        return result
    }

    private static func canFoldPendingActivity(_ activity: [TranscriptItem], into item: TranscriptItem) -> Bool {
        guard item.kind == .assistant, !activity.isEmpty else { return false }
        return activity.allSatisfy(Self.isSettledActivityItem)
    }

    private static func isSettledActivityItem(_ item: TranscriptItem) -> Bool {
        switch item.kind {
        case .tool:
            return item.toolStatus != .running
        case .assistant:
            return !item.isStreaming
        case .agents, .user, .system, .error:
            return false
        }
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
    #endif

    /// Belongs in the turn's activity timeline: a tool call, or an assistant
    /// segment that is pure thinking (no visible reply text). The moment a
    /// streaming segment produces text it leaves the timeline and becomes
    /// the reply row.
    static func isActivityItem(_ item: TranscriptItem) -> Bool {
        item.isActivityTimelineItem
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
                    Group {
                        if row.isToolGroup {
                            ToolActivityStrip(items: row.items)
                        } else {
                            TranscriptRow(
                                item: row.items[0],
                                showInlineReasoning: row.showInlineReasoning,
                                foldedActivityItems: row.foldedActivityItems
                            )
                        }
                    }
                    .transition(rowTransition)
                }
                StreamingFooter(chat: chat)
            }
            .animation(rowAnimation, value: chat.items.count)
            .padding(.horizontal, 16)
            .padding(.top, 10)
            // Tunes the pinned tail: the newest row sits this far + the
            // structural floor (row inset + footer + bottom-chrome spacing,
            // ~46pt) above the composer. 2 → ~48pt total above the keyboard.
            .padding(.bottom, 2)
        }
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
            guard new > old + 1, !isAwayFromBottom, !userInteracting else { return }
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
        .onChange(of: chat.isStreaming) { _, streaming in
            // A turn becoming active WITHOUT a send — reconcile() resuming a live
            // turn after a backgrounded disconnect bumps no sendTick — must not
            // inherit a stale away-latch from before the drop.
            if streaming { isAwayFromBottom = false }
        }
        .onAppear {
            refreshGroupedRows(force: true)
        }
        .onChange(of: groupingSignature) {
            refreshGroupedRows()
        }
        .onChange(of: followSignal) {
            // Follow the latest content while the user is at the bottom.
            // Streaming changes are not limited to assistant text: tool results,
            // screenshot rows, status text, and delegated-agent cards can all
            // change height in place without inserting a new transcript row.
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
        cachedGroupedRows = Self.groupRows(chat.items)
        cachedGroupingSignature = signature
    }

    /// Tail-only render-height signal for auto-following the transcript bottom.
    /// The previous implementation hashed every row and every agent field, which
    /// made one streamed token invalidate this whole scroll container and queue a
    /// scroll. Track the active tail instead, and bucket text growth so we follow
    /// line-height changes without issuing a scroll request for every token.
    private var followSignal: TranscriptFollowSignal {
        guard let tail = chat.items.last(where: { !$0.isSessionNotice }) else {
            return TranscriptFollowSignal(
                isLoadingHistory: chat.isLoadingHistory,
                isStreaming: chat.isStreaming,
                statusTextBucket: textBucket(chat.statusText?.count ?? 0),
                errorTextBucket: textBucket(chat.lastError?.count ?? 0),
                itemCount: chat.items.count
            )
        }

        let activeRun = tail.agentRuns.last(where: { $0.status == .working || $0.status == .queued })
            ?? tail.agentRuns.last
        return TranscriptFollowSignal(
            isLoadingHistory: chat.isLoadingHistory,
            isStreaming: chat.isStreaming,
            statusTextBucket: textBucket(chat.statusText?.count ?? 0),
            errorTextBucket: textBucket(chat.lastError?.count ?? 0),
            itemCount: chat.items.count,
            tailID: tail.id,
            tailKind: kindSignature(tail.kind),
            tailTextBucket: textBucket(tail.text.count),
            tailReasoningBucket: textBucket(tail.reasoning.count),
            tailMediaCount: tail.images.count + tail.videos.count + tail.linkPreviews.count,
            tailStreaming: tail.isStreaming,
            tailActivityItem: tail.isActivityTimelineItem,
            tailToolStatus: Self.toolStatusSignature(tail.toolStatus),
            tailToolOutputBucket: textBucket(
                tail.toolContext.count + tail.toolSummary.count + tail.toolResultText.count
            ),
            tailAgentCount: tail.agentRuns.count,
            tailAgentsSettled: tail.agentsSettled,
            activeAgentID: activeRun?.id,
            activeAgentStatus: activeRun.map { agentStatusSignature($0.status) } ?? -1,
            activeAgentActivityCount: activeRun?.activity.count ?? 0,
            activeAgentSummaryBucket: textBucket(activeRun?.summary.count ?? 0)
        )
    }

    private func kindSignature(_ kind: TranscriptItem.Kind) -> Int {
        switch kind {
        case .user: 0
        case .assistant: 1
        case .tool: 2
        case .agents: 3
        case .system: 4
        case .error: 5
        }
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

    private func agentStatusSignature(_ status: AgentRunStatus) -> Int {
        switch status {
        case .queued: 0
        case .working: 1
        case .done: 2
        case .failed: 3
        }
    }

    private var rowTransition: AnyTransition {
        // Opacity only. A `.move(edge: .bottom)` insertion translates the row and
        // grows content height on a curve — that fights bottom-pinning during
        // streaming and turns a reconcile's row swap into a slide/flash. A fade
        // keeps the entrance without moving the geometry the pin tracks.
        .opacity
    }

    private var rowAnimation: Animation {
        reduceMotion ? .linear(duration: 0.12) : .snappy(duration: 0.24)
    }
}

private struct TranscriptFollowSignal: Equatable {
    var isLoadingHistory = false
    var isStreaming = false
    var statusTextBucket = 0
    var errorTextBucket = 0
    var itemCount = 0
    var tailID: UUID?
    var tailKind = -1
    var tailTextBucket = 0
    var tailReasoningBucket = 0
    var tailMediaCount = 0
    var tailStreaming = false
    var tailActivityItem = false
    var tailToolStatus = -1
    var tailToolOutputBucket = 0
    var tailAgentCount = 0
    var tailAgentsSettled = false
    var activeAgentID: String?
    var activeAgentStatus = -1
    var activeAgentActivityCount = 0
    var activeAgentSummaryBucket = 0
}

private struct TranscriptGroupingSignature: Equatable {
    var itemCount = 0
    var tail: [TranscriptGroupingKey] = []
}

private struct TranscriptGroupingKey: Equatable {
    var id: UUID
    var isSessionNotice: Bool
    var isActivityItem: Bool
    var isStreaming: Bool
    var hasReasoning: Bool
    var toolStatus: Int
}

private struct TranscriptRowGroup: Identifiable {
    let id: UUID
    var items: [TranscriptItem]
    var showInlineReasoning = true
    var foldedActivityItems: [TranscriptItem] = []
    var isToolGroup: Bool {
        items.first.map(TranscriptView.isActivityItem) ?? false
    }
}

/// Glass "jump to latest" affordance shown when the user scrolls up.
/// Rendered by the thread's bottom chrome, beside the diff pill.
struct ScrollToBottomButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.down")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.primary)
                .frame(width: 38, height: 38)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
    }
}

/// Persistent turn liveness under the last item: AICSS G4 helix/globe
/// plus a phrase that starts as "Thinking" and swaps to the current action.
/// Like desktop, it remains visible until the active turn completes.
private struct StreamingFooter: View {
    let chat: ChatModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if chat.isStreaming {
                LiveStatusLine(phrase: livePhrase)
                    .transition(.opacity)
            }
            if let error = chat.lastError {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(.vertical, 2)
        .animation(.spring(response: 0.32, dampingFraction: 0.88), value: livePhrase)
    }

    private var livePhrase: String {
        LiveStatusPhrase.current(from: chat.items, fallback: chat.statusText)
    }

}
