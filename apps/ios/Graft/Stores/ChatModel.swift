import Foundation
import UIKit

/// One remote thread's live transcript. Adapts the Hermes chat pipeline to the
/// Graft snapshot+timeline protocol: the environment snapshot is authoritative
/// for settled history (folded in via an identity-preserving reconcile), while
/// streamed timeline events animate the in-flight turn between refreshes.
@MainActor
@Observable
final class ChatModel: Identifiable {
    let id = UUID()
    let threadId: String
    var title: String

    weak var app: AppModel?
    let fileLinks: WorkspaceFileLinks

    private(set) var items: [TranscriptItem] = []
    private(set) var isStreaming = false
    private var historyLoading = false
    var isLoadingHistory: Bool { historyLoading && app?.gateway.state == .connected }
    private(set) var statusText: String?
    private(set) var taskProgressState = TaskProgressState()
    var taskProgress: TaskProgress? { taskProgressState.visible }

    var pendingApproval: ApprovalRequest?
    var pendingClarify: ClarifyRequest?
    var pendingSecret: SecretRequest?

    /// True when the interaction bar has a prompt to show. Gates its mount so
    /// an empty bar never occupies a stack slot (which would double the
    /// spacing between the diff pill and the composer).
    var needsInteraction: Bool {
        pendingApproval != nil || pendingClarify != nil || pendingSecret != nil
    }
    /// Working-tree / run diffs advertised by `diff.updated` or fetched on demand.
    private(set) var pendingDiffs: [ComposerDiffPresentation] = []
    private(set) var openedDiff: DiffSummary?
    private var diffRequestGeneration = 0
    private var requestedDiffId: String?
    var attachments: [PendingAttachment] = []
    var lastError: String?

    /// Bumped when the user sends, so the view can force-scroll to bottom.
    private(set) var sendTick = 0

    /// Live successful replies only; history reconciliation stays silent.
    private(set) var responseCompletionTick = 0

    /// Mirror of the transcript's away-from-bottom latch, so chrome outside
    /// `TranscriptView` (the jump arrow beside the diff pill) can react.
    var isAwayFromLatest = false
    /// Bumped by that chrome to ask the transcript to re-pin to the latest row.
    private(set) var scrollToLatestTick = 0

    func scrollToLatest() {
        scrollToLatestTick += 1
    }

    var isTurnActive: Bool { isStreaming && (app == nil || app?.gateway.state == .connected) }

    /// The desktop keeps one progress indicator for the whole active turn.
    /// Text, reasoning, and tools can interleave without unmounting it.
    var liveStatusText: String? {
        guard isTurnActive else { return nil }
        if needsInteraction { return "Waiting for you" }
        return LiveStatusPhrase.current(from: items, fallback: statusText)
    }

    var canChangeProvider: Bool {
        hasLoadedTranscript && cacheHydratedCursor == nil && sendTick == 0 && !isStreaming
            && !items.contains { $0.kind == .user || $0.kind == .assistant || $0.kind == .tool }
    }

    /// Latest run id seen for this thread — the target for `turn.cancel`.
    private var activeRunId: String?
    /// The assistant row currently absorbing `assistant.delta` /
    /// `thinking.delta` frames. Deltas carry the part's full accumulated text,
    /// so folding is assignment, not append.
    private var currentAssistant: TranscriptItem?
    private var assistantItems: [String: TranscriptItem] = [:]
    private var completedMessageIDs: Set<String> = []
    private var completedRunIDs: Set<String> = []
    private var awaitingTurnAcknowledgement = false
    /// Live tool rows keyed by their originating part id, so a completion
    /// frame updates the row in place.
    private var toolItems: [String: TranscriptItem] = [:]
    /// Highest transcript cursor covered by a snapshot reconcile. Live frames
    /// at or below this are already represented in `items`.
    private var transcriptCursor = 0
    /// Cursor the transcript was cache-hydrated at, until the first
    /// authoritative snapshot supersedes it. Lets that snapshot replace stale
    /// cached state even when the host's cursor moved backwards (a rollback
    /// while the phone was away).
    private var cacheHydratedCursor: Int?
    private var hasLoadedTranscript = false
    private var historyLoadingIndicatorTask: Task<Void, Never>?
    private var deferredAttachTask: Task<Void, Never>?

    private static let historyLoadingIndicatorDelay: Duration = .milliseconds(280)

    init(threadId: String, title: String, app: AppModel? = nil) {
        self.threadId = threadId
        self.title = title
        self.app = app
        fileLinks = WorkspaceFileLinks(threadId: threadId, app: app)
        startHistoryLoadingIndicator()
    }

    // MARK: History loading indicator

    /// Show the loading state only if the first snapshot lingers — a cached or
    /// fast transcript paints without an indicator flash.
    private func startHistoryLoadingIndicator() {
        historyLoadingIndicatorTask?.cancel()
        historyLoadingIndicatorTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: Self.historyLoadingIndicatorDelay)
            guard let self, !Task.isCancelled, !self.hasLoadedTranscript else { return }
            self.historyLoading = true
        }
    }

    func finishHistoryLoading() { cancelHistoryLoadingIndicator() }

    private func cancelHistoryLoadingIndicator() {
        historyLoadingIndicatorTask?.cancel()
        historyLoadingIndicatorTask = nil
        historyLoading = false
    }

    // MARK: Snapshot reconcile

    /// Fold an authoritative environment snapshot into this thread's state.
    /// Called by `AppModel` on every snapshot refresh.
    func applySnapshot(_ snapshot: EnvironmentSnapshot) {
        let replacingCache = cacheHydratedCursor == transcriptCursor
        guard replacingCache || snapshot.cursor >= transcriptCursor else { return }
        if let thread = snapshot.threads.first(where: { $0.id == threadId }) {
            title = thread.title
        }
        applyPendingInteractions(snapshot)

        guard let transcript = snapshot.selectedTranscript,
              transcript.threadId == threadId
        else {
            applyRunState(snapshot)
            return
        }
        hasLoadedTranscript = true
        cancelHistoryLoadingIndicator()

        if let cachedCursor = cacheHydratedCursor {
            cacheHydratedCursor = nil
            if transcriptCursor == cachedCursor {
                // No live frames advanced past the cached state, so the first
                // authoritative transcript wins outright — even at a lower
                // cursor than the (possibly rolled-back) cache.
                transcriptCursor = transcript.cursor
                currentAssistant = nil
                toolItems = [:]
                applyReconciledItems(Self.itemize(transcript.events))
                taskProgressState = .replay(transcript.events)
                rebindStreamingTail()
                applyRunState(snapshot)
                deferAttachRecentWindow()
                return
            }
        }

        // Live frames folded since the last refresh can be ahead of this
        // transcript; replacing `items` with an older view would visibly
        // rewind the in-flight turn.
        guard transcript.cursor >= transcriptCursor else { return }
        transcriptCursor = max(transcriptCursor, transcript.cursor)

        currentAssistant = nil
        toolItems = [:]
        applyReconciledItems(Self.itemize(transcript.events))
        taskProgressState = .replay(transcript.events)
        rebindStreamingTail()
        applyRunState(snapshot)
        deferAttachRecentWindow()
    }

    /// Paint a disk-cached transcript immediately while the authoritative
    /// snapshot round-trips to the host. A no-op once any transcript loaded.
    func applyCachedTranscript(_ transcript: TranscriptContainer) {
        guard !hasLoadedTranscript, transcript.threadId == threadId else { return }
        hasLoadedTranscript = true
        cancelHistoryLoadingIndicator()
        transcriptCursor = transcript.cursor
        cacheHydratedCursor = transcript.cursor
        applyReconciledItems(Self.itemize(transcript.events))
        taskProgressState = .replay(transcript.events)
        rebindStreamingTail()
        deferAttachRecentWindow()
    }

    private func applyPendingInteractions(_ snapshot: EnvironmentSnapshot) {
        if let approval = snapshot.pendingApprovals.first(where: { $0.threadId == threadId }) {
            if pendingApproval?.approvalID != approval.id {
                pendingApproval = ApprovalRequest(approval: approval)
            }
        } else {
            pendingApproval = nil
        }

        if let question = snapshot.pendingQuestions.first(where: { $0.threadId == threadId }) {
            if pendingClarify?.requestID != question.id {
                pendingClarify = ClarifyRequest(question: question)
            }
        } else {
            pendingClarify = nil
        }
    }

    private func applyRunState(_ snapshot: EnvironmentSnapshot) {
        let active = snapshot.activeRuns.first {
            $0.threadId == threadId && Self.isActiveRunStatus($0.status)
                && !completedRunIDs.contains($0.id)
        }
        if let active {
            activeRunId = active.id
            isStreaming = true
            for item in items where item.runID != nil && item.runID != active.id {
                settle(item)
            }
        } else if !awaitingTurnAcknowledgement {
            finishTurn()
        }
    }

    private static func isActiveRunStatus(_ status: String) -> Bool {
        switch status {
        case "queued", "running", "waiting", "starting":
            return true
        default:
            return false
        }
    }

    /// After a reconcile replaced `items`, re-point the delta accumulator at
    /// the transcript's trailing streaming row (if any) so live frames keep
    /// updating the same bubble.
    private func rebindStreamingTail() {
        assistantItems = [:]
        for item in items where item.kind == .assistant {
            if let source = item.sourceID { assistantItems[source] = item }
        }
        completedMessageIDs.formUnion(items.filter(\.isMessageComplete).compactMap(\.sourceID))
        currentAssistant = items.last(where: { $0.kind == .assistant && $0.isStreaming })
    }

    // MARK: Live event folding

    /// Fold one streamed timeline frame. Called by `AppModel` for every
    /// gateway `event` envelope whose `threadId` matches.
    func fold(_ event: TimelineEvent) {
        if event.cursor > 0 {
            guard event.cursor > transcriptCursor else { return }
            transcriptCursor = event.cursor
        }
        if let runId = event.runId, completedRunIDs.contains(runId),
           ["assistant.delta", "thinking.delta", "tool.start", "tool.update", "tool.end", "status"].contains(event.kind) {
            return
        }

        if ["user.message", "plan.update", "todo.update"].contains(event.kind) {
            taskProgressState.fold(event)
        }
        switch event.kind {
        case "user.message":
            foldUserMessage(event)
        case "assistant.delta":
            foldAssistantDelta(event)
        case "assistant.message":
            foldAssistantMessage(event)
        case "thinking.delta":
            foldThinkingDelta(event)
        case "tool.start":
            foldToolStart(event)
        case "tool.update":
            foldToolStart(event)
        case "tool.end":
            foldToolEnd(event)
        case "approval.requested":
            pendingApproval = ApprovalRequest(
                approvalID: event.approvalId ?? event.id,
                command: event.toolName ?? "",
                description: event.text ?? ""
            )
        case "approval.resolved":
            if pendingApproval?.approvalID == (event.approvalId ?? event.id) {
                pendingApproval = nil
            }
        case "question.requested":
            pendingClarify = ClarifyRequest(
                requestID: event.questionId ?? event.id,
                question: event.text ?? ""
            )
        case "question.resolved":
            if pendingClarify?.requestID == (event.questionId ?? event.id) {
                pendingClarify = nil
            }
        case "run.status":
            foldRunStatus(event)
        case "status":
            if isStreaming, event.runId == nil || event.runId == activeRunId,
               let text = event.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
                statusText = text
            }
        case "diff.updated":
            let diffId = event.diffId ?? event.threadId ?? threadId
            Task { await refreshDiff(diffId: diffId) }
        case "error":
            foldError(event)
        default:
            break
        }
    }

    /// Check working-tree edits while this thread is visible and running.
    /// Checkpoint notifications alone arrive too late to show edits mid-turn.
    func pollWorkingDiff() async {
        while !Task.isCancelled {
            await refreshDiff()
            guard isTurnActive else { return }
            do { try await Task.sleep(for: .seconds(2)) }
            catch { return }
        }
    }

    /// Load (or refresh) a diff summary for the composer strip.
    func refreshDiff(diffId: String? = nil) async {
        guard !Task.isCancelled, let app, app.gateway.state == .connected else { return }
        diffRequestGeneration += 1
        let generation = diffRequestGeneration
        let id = diffId ?? threadId
        guard let summary = await app.fetchDiff(diffId: id) else { return }
        guard !Task.isCancelled, generation == diffRequestGeneration,
              app.gateway.state == .connected else { return }
        upsertDiffPresentation(from: summary)
        if openedDiff?.id == summary.id || requestedDiffId == summary.id {
            openedDiff = summary.files.isEmpty ? nil : summary
            requestedDiffId = nil
        }
    }

    func openDiff(id: String) async {
        // A concurrent refresh may finish first; open the newest summary.
        requestedDiffId = id
        await refreshDiff(diffId: id)
    }

    func dismissOpenedDiff() {
        requestedDiffId = nil
        openedDiff = nil
    }

    func upsertDiffPresentation(from summary: DiffSummary) {
        guard !summary.files.isEmpty else {
            pendingDiffs.removeAll { $0.id == summary.id }
            return
        }
        let presentation = ComposerDiffPresentation(
            id: summary.id,
            title: summary.title,
            files: summary.files.map {
                ComposerDiffFilePresentation(
                    path: $0.path,
                    additions: $0.additions ?? 0,
                    deletions: $0.deletions ?? 0
                )
            }
        )
        if let index = pendingDiffs.firstIndex(where: { $0.id == presentation.id }) {
            pendingDiffs[index] = presentation
        } else {
            pendingDiffs.insert(presentation, at: 0)
        }
    }

    static func sourceID(for event: TimelineEvent) -> String {
        let partID = event.id.replacingOccurrences(of: ":(?:delta:[0-9]+|complete)$", with: "", options: .regularExpression)
        let channel = event.kind == "thinking.delta" ? "reasoning" : event.kind == "user.message" ? "user" : "assistant"
        return "\(channel):\(partID)"
    }

    private func foldUserMessage(_ event: TimelineEvent) {
        let text = (event.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let attachments = event.attachments ?? []
        guard !text.isEmpty || !attachments.isEmpty else { return }
        let source = Self.sourceID(for: event)
        if let existing = items.first(where: { $0.sourceID == source }) {
            existing.mergeSkills(event.skills)
            return
        }
        // Only a local optimistic row may match by text.
        if let lastUser = items.last(where: { $0.kind == .user }), lastUser.sourceID == nil,
           lastUser.normalizedMergeText == TranscriptItem.normalizeForMerge(text),
           lastUser.attachments == attachments {
            lastUser.sourceID = source
            lastUser.mergeSkills(event.skills)
            lastUser.createdAt = event.createdAt
            return
        }
        settleCurrentAssistant()
        let item = TranscriptItem.user(text, attachments: attachments, skills: event.skills ?? [])
        item.sourceID = source
        item.runID = event.runId
        item.createdAt = event.createdAt
        items.append(item)
        startWorking(event)
    }

    private func foldAssistantDelta(_ event: TimelineEvent) {
        guard !completedMessageIDs.contains(Self.sourceID(for: event)),
              let text = event.text, !text.isEmpty else { return }
        let item = ensureCurrentAssistant(for: event)
        item.text = text
        item.isStreaming = true
        startWorking(event)
        statusText = nil
    }

    private func foldAssistantMessage(_ event: TimelineEvent) {
        let text = event.text ?? ""
        guard !text.isEmpty || assistantItems[Self.sourceID(for: event)] != nil else { return }
        let item = ensureCurrentAssistant(for: event)
        if !text.isEmpty { item.text = text }
        item.isStreaming = false
        item.isMessageComplete = true
        item.completedAt = event.completedAt ?? event.createdAt
        completedMessageIDs.insert(Self.sourceID(for: event))
        finishReasoningClock(item)
        Self.attachRichContent(to: item)
        if currentAssistant === item { currentAssistant = nil }
        statusText = nil
    }

    private func foldThinkingDelta(_ event: TimelineEvent) {
        guard !completedMessageIDs.contains(Self.sourceID(for: event)),
              let text = event.text, !text.isEmpty else { return }
        let item = ensureCurrentAssistant(for: event)
        item.isStreaming = true
        if item.reasoningStartedAt == nil { item.reasoningStartedAt = Date() }
        item.reasoning = text
        startWorking(event)
    }

    private func foldToolStart(_ event: TimelineEvent) {
        let name = event.toolName ?? "tool"
        let context = Self.toolContext(event)
        if let existing = toolItems[event.toolIdentity] {
            if let name = event.toolName { existing.toolName = name }
            if !context.isEmpty { existing.toolContext = context }
            return
        }
        settleCurrentAssistant()
        let item = TranscriptItem.tool(id: event.toolIdentity, name: name, context: context)
        item.runID = event.runId
        item.createdAt = event.createdAt
        toolItems[event.toolIdentity] = item
        items.append(item)
        statusText = Self.toolStatusLine(name: name)
        startWorking(event)
    }

    private func foldToolEnd(_ event: TimelineEvent) {
        let existing = toolItems[event.toolIdentity]
        let name = event.toolName ?? existing?.toolName ?? "tool"
        if let existing {
            existing.toolStatus = .done
            existing.completedAt = event.createdAt
            if existing.toolResultText.isEmpty, let text = event.text, text != existing.toolContext {
                existing.toolResultText = String(text.prefix(4000))
            }
        } else {
            let item = TranscriptItem.tool(
                id: event.toolIdentity, name: name, context: Self.toolContext(event), status: .done
            )
            item.runID = event.runId
            item.createdAt = event.createdAt
            item.completedAt = event.createdAt
            toolItems[event.toolIdentity] = item
            items.append(item)
        }
        if statusText == Self.toolStatusLine(name: name) {
            statusText = nil
        }
    }

    private func foldRunStatus(_ event: TimelineEvent) {
        guard let status = event.runStatus else { return }
        if let runID = event.runId, completedRunIDs.contains(runID) { return }
        if Self.isActiveRunStatus(status) {
            startWorking(event)
        } else {
            if let runID = event.runId {
                completedRunIDs.insert(runID)
                if let activeRunId, activeRunId != runID {
                    for item in items where item.runID == runID { settle(item) }
                    return
                }
            }
            if status == "failed" || status == "error" {
                appendErrorItem("The run failed.")
            }
            if status == "completed", isStreaming,
               let answer = items.last(where: { $0.kind == .assistant && $0.runID == activeRunId }),
               !answer.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                responseCompletionTick += 1
            }
            finishTurn(failed: status == "failed" || status == "error")
        }
    }

    private func foldError(_ event: TimelineEvent) {
        let text = (event.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if let runID = event.runId, let activeRunId, runID != activeRunId {
            completedRunIDs.insert(runID)
            for item in items where item.runID == runID { settle(item, failed: true) }
            return
        }
        appendErrorItem(text.isEmpty ? "Something went wrong." : text)
        if event.runId == nil || activeRunId == nil || event.runId == activeRunId {
            finishTurn(failed: true)
        }
    }

    private func appendErrorItem(_ text: String) {
        settleCurrentAssistant()
        // A repeated failure frame (live + snapshot echo) shouldn't stack.
        if let last = items.last, last.kind == .error, last.text == text { return }
        items.append(.error(text))
    }

    private func ensureCurrentAssistant(for event: TimelineEvent) -> TranscriptItem {
        let source = Self.sourceID(for: event)
        if let existing = assistantItems[source] {
            if event.kind != "assistant.message", currentAssistant !== existing {
                settleCurrentAssistant()
                currentAssistant = existing
            }
            return existing
        }
        settleCurrentAssistant()
        let item = TranscriptItem.assistant("", streaming: true)
        item.sourceID = source
        item.runID = event.runId
        item.createdAt = event.createdAt
        assistantItems[source] = item
        currentAssistant = item
        items.append(item)
        return item
    }

    private func settleCurrentAssistant() {
        guard let current = currentAssistant else { return }
        current.isStreaming = false
        finishReasoningClock(current)
        if current.text.isEmpty && current.reasoning.isEmpty {
            // Nothing ever streamed into it; drop the empty shell.
            items.removeAll { $0 === current }
        } else {
            Self.attachRichContent(to: current)
        }
        currentAssistant = nil
    }

    private func finishReasoningClock(_ item: TranscriptItem) {
        if let started = item.reasoningStartedAt, item.reasoningDuration == nil {
            item.reasoningDuration = Date().timeIntervalSince(started)
        }
        item.reasoningStartedAt = nil
    }

    private func startWorking(_ event: TimelineEvent) {
        if let runID = event.runId { activeRunId = runID }
        isStreaming = true
    }

    private func settle(_ item: TranscriptItem, failed: Bool = false) {
        item.isStreaming = false
        finishReasoningClock(item)
        if item.kind == .assistant {
            item.isMessageComplete = true
            if let source = item.sourceID { completedMessageIDs.insert(source) }
        } else if item.kind == .tool, item.toolStatus == .running {
            item.toolStatus = failed ? .failed : .done
        }
    }

    private func finishTurn(failed: Bool = false) {
        for item in items { settle(item, failed: failed) }
        settleCurrentAssistant()
        if let activeRunId { completedRunIDs.insert(activeRunId) }
        awaitingTurnAcknowledgement = false
        isStreaming = false
        statusText = nil
        activeRunId = nil
    }

    private static func toolContext(_ event: TimelineEvent) -> String {
        let text = (event.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        // The part content often repeats the tool name; that's chrome, not context.
        if text == event.toolName { return "" }
        return String(text.prefix(300))
    }

    private static func toolStatusLine(name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty
            ? LiveStatusPhrase.thinking
            : ToolPresentation(name: trimmed, context: "").runningPhrase
    }

    // MARK: Sending & interactions

    /// Submit a turn. Optimistically appends the user bubble; the host's echo
    /// event is deduplicated in `foldUserMessage`.
    @discardableResult
    func send(_ rawText: String, skill: ComposerCommand? = nil) async -> Bool {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isStreaming, let app else { return false }
        lastError = nil
        settleCurrentAssistant()
        let selected = ComposerSkillText.leadingSkill(in: text, selected: skill)
        items.append(.user(text, skills: selected.map {
            [MessageSkill(name: $0.name, displayName: $0.displayName)]
        } ?? []))
        attachments = []
        sendTick += 1
        taskProgressState.beginTurn(id: "local:\(sendTick)")
        awaitingTurnAcknowledgement = true
        isStreaming = true
        let sent = await app.startTurn(threadId: threadId, text: text)
        awaitingTurnAcknowledgement = false
        if !sent {
            finishTurn(failed: true)
            lastError = app.gatewayError?.localizedDescription ?? "Message failed to send."
            appendErrorItem(lastError ?? "Message failed to send.")
        }
        return sent
    }

    func interrupt() async {
        guard let app, let runId = activeRunId else { return }
        do {
            try await app.gateway.send(
                ClientCommandEnvelope(command: .turnCancel(TurnCancelCommand(runId: runId)))
            )
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// `choice` uses the Hermes vocabulary the prompt buttons emit
    /// ("deny" / "once" / "session" / "always"); the Graft protocol collapses
    /// session and always into `allow_session`.
    func respondApproval(choice: String, all: Bool = false) async {
        guard let app, let approval = pendingApproval else { return }
        pendingApproval = nil
        let decision: String
        switch choice {
        case "deny":
            decision = "deny"
        case "once":
            decision = "allow_once"
        default:
            decision = "allow_session"
        }
        _ = await app.resolveApproval(id: approval.approvalID, decision: decision)
    }

    func respondClarify(answer: String) async {
        guard let app, let request = pendingClarify else { return }
        pendingClarify = nil
        // Prefer the option id when the tapped answer matches a host-provided
        // choice; a typed custom answer goes through as freeform text.
        var optionId: String?
        if let index = request.choices.firstIndex(of: answer),
           request.choiceIDs.indices.contains(index)
        {
            optionId = request.choiceIDs[index]
        }
        do {
            try await app.gateway.send(
                ClientCommandEnvelope(
                    command: .questionResolve(
                        QuestionResolveCommand(
                            questionId: request.requestID,
                            optionId: optionId,
                            text: optionId == nil ? answer : nil
                        )
                    )
                )
            )
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// The Graft protocol has no secret channel; `pendingSecret` is never set,
    /// so this is unreachable in practice. Kept for view compatibility.
    func respondSecret(value: String) async {
        pendingSecret = nil
    }

    // MARK: Itemization

    /// Build transcript rows from an authoritative snapshot transcript.
    static func itemize(_ events: [TimelineEvent]) -> [TranscriptItem] {
        var result: [TranscriptItem] = []
        var current: TranscriptItem?
        var toolRows: [String: TranscriptItem] = [:]
        var messageRows: [String: TranscriptItem] = [:]
        var completedRuns: Set<String> = []
        var userIDs: Set<String> = []

        func settle(_ item: TranscriptItem?) {
            guard let item else { return }
            item.isStreaming = false
        }

        for event in events {
            let runCompleted = event.runId.map { completedRuns.contains($0) } ?? false
            if runCompleted, ["assistant.delta", "thinking.delta", "tool.start", "tool.update"].contains(event.kind) {
                continue
            }
            switch event.kind {
            case "user.message":
                guard userIDs.insert(sourceID(for: event)).inserted else { continue }
                settle(current)
                current = nil
                let text = (event.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                let attachments = event.attachments ?? []
                if !text.isEmpty || !attachments.isEmpty {
                    let images = ChatImageExtractor.sources(inText: text)
                    let item = TranscriptItem.user(text, attachments: attachments, skills: event.skills ?? [])
                    item.sourceID = sourceID(for: event)
                    item.runID = event.runId
                    item.createdAt = event.createdAt
                    if !images.isEmpty { item.images = images.map(ChatImage.init) }
                    result.append(item)
                }
            case "assistant.message", "assistant.delta", "thinking.delta":
                let text = event.text ?? ""
                let source = sourceID(for: event)
                guard !text.isEmpty || messageRows[source] != nil else { break }
                let item: TranscriptItem
                if let existing = messageRows[source] {
                    if existing.isMessageComplete && event.kind != "assistant.message" { continue }
                    item = existing
                    if event.kind != "assistant.message", current !== item {
                        settle(current)
                        current = item
                    }
                } else {
                    settle(current)
                    item = TranscriptItem.assistant("", streaming: true)
                    item.sourceID = source
                    item.runID = event.runId
                    item.createdAt = event.createdAt
                    messageRows[source] = item
                    result.append(item)
                    current = item
                }
                if event.kind == "thinking.delta" { item.reasoning = text }
                else if !text.isEmpty { item.text = text }
                item.isStreaming = event.kind != "assistant.message"
                item.isMessageComplete = event.kind == "assistant.message"
                if item.isMessageComplete { item.completedAt = event.completedAt ?? event.createdAt }
                if event.kind == "assistant.message", current === item { current = nil }
            case "tool.start", "tool.update", "tool.end":
                let name = event.toolName ?? "tool"
                let context = Self.toolContext(event)
                let status: ToolRunStatus = event.kind == "tool.end" ? .done : .running
                if let existing = toolRows[event.toolIdentity] {
                    if existing.toolStatus == .running { existing.toolStatus = status }
                    if status == .done { existing.completedAt = event.createdAt }
                    if existing.toolContext.isEmpty { existing.toolContext = context }
                } else {
                    settle(current)
                    current = nil
                    let item = TranscriptItem.tool(id: event.toolIdentity, name: name, context: context, status: status)
                    item.runID = event.runId
                    item.createdAt = event.createdAt
                    if status == .done { item.completedAt = event.createdAt }
                    toolRows[event.toolIdentity] = item
                    result.append(item)
                }
            case "run.status", "error":
                guard event.kind == "error" || event.runStatus.map({ !isActiveRunStatus($0) }) == true else { continue }
                if let runID = event.runId { completedRuns.insert(runID) }
                for item in result where event.runId == nil || item.runID == nil || item.runID == event.runId {
                    settle(item)
                    item.isMessageComplete = item.kind == .assistant
                    if item.kind == .tool, item.toolStatus == .running {
                        item.toolStatus = event.kind == "error" || event.runStatus == "failed" ? .failed : .done
                    }
                    if current === item { current = nil }
                }
                if event.kind == "error" {
                    let text = (event.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    if !text.isEmpty, result.last?.kind != .error || result.last?.text != text {
                        result.append(.error(text))
                    }
                }
            default:
                break
            }
        }
        return result
    }

    // MARK: Identity-preserving reconcile (ported from Hermes)

    /// Replace `items` with `fresh` WITHOUT churning row identity: reuse each
    /// surviving row's existing `TranscriptItem` (and its UUID) whenever a
    /// fresh row matches by `mergeKey`, mutating it in place; only genuinely
    /// new rows are inserted. Wholesale `items = fresh` would mint all-new
    /// identities, so SwiftUI's `ForEach` would remove+insert every row — the
    /// "screen goes blank, then everything reloads" flash on a refresh.
    func applyReconciledItems(_ fresh: [TranscriptItem]) {
        var survivors: [String: [TranscriptItem]] = [:]
        for item in items { survivors[item.mergeKey, default: []].append(item) }

        var merged: [TranscriptItem] = []
        merged.reserveCapacity(fresh.count)
        for incoming in fresh {
            // Match an optimistic user bubble once, then bind it to its host ID.
            let optimistic = incoming.kind == .user ? items.last(where: { item in
                item.kind == .user && item.sourceID == nil && item.normalizedMergeText == incoming.normalizedMergeText
                    && !merged.contains(where: { $0 === item })
            }) : nil
            if let reused = survivors[incoming.mergeKey]?.first ?? optimistic {
                survivors[reused.mergeKey]?.removeFirst()
                reused.absorb(incoming)
                merged.append(reused)
            } else {
                merged.append(incoming)
            }
        }
        if awaitingTurnAcknowledgement {
            merged.append(contentsOf: items.filter { item in
                item.kind == .user && item.sourceID == nil && !merged.contains(where: { $0 === item })
            })
        }
        items = merged

        // Re-key the live tool map to the surviving rows.
        toolItems = [:]
        for item in merged where item.kind == .tool && !item.toolID.isEmpty {
            toolItems[item.toolID] = item
        }
    }

    // MARK: Rich content (ported from Hermes)

    /// Video clips and source links referenced in an assistant row's prose.
    /// Rendered media refs are then scrubbed from the display text — the
    /// thumbnail is the content, the path is plumbing.
    static func attachRichContent(to item: TranscriptItem) {
        guard !item.richContentAttached else { return }
        // Oversized rows render as a plain preview, so the regex passes below
        // would be wasted main-thread work.
        guard !item.isOversized else {
            item.richContentAttached = true
            return
        }
        if item.images.isEmpty {
            let images = ChatImageExtractor.sources(inText: item.text)
            if !images.isEmpty { item.images = images.map(ChatImage.init) }
        }
        if item.videos.isEmpty {
            let clips = ChatVideoExtractor.sources(inText: item.text)
            if !clips.isEmpty { item.videos = clips.map(ChatVideo.init) }
        }
        if !item.images.isEmpty || !item.videos.isEmpty {
            let scrubbed = MediaRefScrubber.scrub(item.text)
            if scrubbed != item.text {
                item.text = scrubbed
            }
        }
        if item.linkPreviews.isEmpty {
            let urls = LinkExtractor.urls(inText: item.text)
            if !urls.isEmpty {
                item.linkPreviews = urls.prefix(12).map(LinkPreviewLoader.init)
            }
        }
        item.richContentAttached = true
    }

    /// Number of trailing rows eager-attached after a transcript load; older
    /// rows attach lazily as they scroll into view.
    static let historyEagerAttachWindow = 40

    static func attachRecentWindow(_ items: [TranscriptItem]) {
        let start = max(0, items.count - historyEagerAttachWindow)
        for item in items[start...] where item.kind == .assistant {
            attachRichContent(to: item)
        }
    }

    private func deferAttachRecentWindow() {
        deferredAttachTask?.cancel()
        deferredAttachTask = Task { @MainActor [weak self] in
            await Task.yield()
            guard let self, !Task.isCancelled else { return }
            Self.attachRecentWindow(self.items)
            self.deferredAttachTask = nil
        }
    }
}
