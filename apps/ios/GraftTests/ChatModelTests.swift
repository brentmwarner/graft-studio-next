import XCTest
@testable import Graft

/// Covers the Graft `ChatModel` adaptation of the Hermes chat pipeline:
/// snapshot itemization, live timeline-event folding, and the
/// identity-preserving reconcile.
@MainActor
final class ChatModelTests: XCTestCase {

    // MARK: Helpers

    private func event(
        id: String,
        cursor: Int,
        kind: String,
        threadId: String = "t1",
        runId: String? = nil,
        text: String? = nil,
        toolName: String? = nil,
        approvalId: String? = nil,
        questionId: String? = nil,
        runStatus: String? = nil,
        attachments: [TimelineAttachment]? = nil
    ) -> TimelineEvent {
        TimelineEvent(
            id: id,
            cursor: cursor,
            kind: kind,
            threadId: threadId,
            runId: runId,
            createdAt: 0,
            text: text,
            toolName: toolName,
            approvalId: approvalId,
            questionId: questionId,
            diffId: nil,
            runStatus: runStatus,
            attachments: attachments
        )
    }

    private func makeChat() -> ChatModel {
        ChatModel(threadId: "t1", title: "Test thread")
    }

    func testAttachmentMetadataSurvivesDecodingLiveEventsAndSnapshots() throws {
        let json = #"{"id":"attachment-turn","cursor":1,"kind":"user.message","threadId":"t1","createdAt":0,"attachments":[{"id":"file-1","type":"file","name":"notes.txt","mimeType":"text/plain","sizeBytes":5}]}"#
        let message = try JSONDecoder().decode(TimelineEvent.self, from: Data(json.utf8))
        let chat = makeChat()
        chat.fold(message)
        XCTAssertEqual(chat.items.count, 1)
        let original = try XCTUnwrap(chat.items.first)
        XCTAssertEqual(original.attachments.first?.name, "notes.txt")
        XCTAssertTrue(original.text.isEmpty)

        chat.applyReconciledItems(ChatModel.itemize([message]))
        XCTAssertTrue(chat.items.first === original)
        XCTAssertEqual(chat.items.first?.attachments, message.attachments)
        chat.fold(message)
        XCTAssertEqual(chat.items.count, 1)
    }

    func testMixedAttachmentMessageDoesNotConsumeAnUnrelatedOptimisticTextRow() {
        let chat = makeChat()
        chat.applyReconciledItems([.user("Review this")])
        let attachment = TimelineAttachment(id: "image-1", type: "image", name: "photo.png", mimeType: "image/png", sizeBytes: 100)
        chat.fold(event(id: "photo-turn", cursor: 1, kind: "user.message", text: "Review this", attachments: [attachment]))
        XCTAssertEqual(chat.items.count, 2)
        XCTAssertEqual(chat.items.last?.attachments, [attachment])
        XCTAssertEqual(ChatModel.itemize([event(id: "photo-turn", cursor: 1, kind: "user.message", text: "Review this", attachments: [attachment])]).first?.attachments, [attachment])
    }

    func testSkillMetadataSurvivesEchoHistoryAndReconciliation() throws {
        let chosen = MessageSkill(name: "swiftui-specialist", displayName: "SwiftUI Specialist")
        let chat = makeChat()
        chat.fold(event(id: "local", cursor: 0, kind: "user.message", text: "/swiftui-specialist Fix chat"))
        let optimistic = try XCTUnwrap(chat.items.first)
        optimistic.sourceID = nil
        optimistic.skills = [chosen]
        var echo = event(id: "user1", cursor: 1, kind: "user.message", text: optimistic.text)
        echo.skills = [MessageSkill(name: chosen.name)]
        chat.fold(echo)
        XCTAssertEqual(chat.items.count, 1)
        XCTAssertTrue(chat.items.first === optimistic)
        XCTAssertEqual(optimistic.skills, [chosen])
        let persisted = try JSONDecoder().decode(TimelineEvent.self, from: JSONEncoder().encode(echo))
        let history = try XCTUnwrap(ChatModel.itemize([persisted]).first)
        XCTAssertEqual(history.skills.map(\.name), [chosen.name])
        optimistic.absorb(history)
        XCTAssertEqual(optimistic.skills, [chosen])
        echo.skills = nil
        optimistic.absorb(try XCTUnwrap(ChatModel.itemize([echo]).first))
        XCTAssertEqual(optimistic.skills, [chosen], "Older hosts must not erase the selected label")
    }

    func testToolLifecycleUsesStableCallIdentityAcrossDistinctEventIDs() {
        var started = event(id: "start", cursor: 1, kind: "tool.start", runId: "run1", toolName: "Read")
        started.toolId = "call1"
        var ended = event(id: "end", cursor: 2, kind: "tool.end", runId: "run1", text: "Read complete")
        ended.toolId = "call1"
        var late = event(id: "late-progress", cursor: 3, kind: "tool.update", runId: "run1")
        late.toolId = "call1"
        let chat = makeChat()
        chat.fold(started)
        let original = chat.items.first
        chat.fold(ended)
        chat.fold(late)
        XCTAssertEqual(chat.items.count, 1)
        XCTAssertTrue(chat.items.first === original)
        XCTAssertEqual(chat.items.first?.toolStatus, .done)
        XCTAssertEqual(chat.items.first?.toolName, "Read")
        XCTAssertEqual(ChatModel.itemize([started, ended, late]).count, 1)
        XCTAssertEqual(ChatModel.itemize([started, ended, late]).first?.toolStatus, .done)
        var nextTurn = event(id: "next-start", cursor: 4, kind: "tool.start", runId: "run2", toolName: "Read")
        nextTurn.toolId = "call1"
        chat.fold(nextTurn)
        XCTAssertEqual(chat.items.count, 2, "Providers may reuse call IDs in a later turn")
    }

    func testMessageActionsAppearOnlyOnTheFinalReplyOfACompletedTurn() {
        let items: [TranscriptItem] = [
            .user("Fix the formatting"),
            .assistant("I will inspect the transcript."),
            .tool(id: "read", name: "Read", context: "TranscriptView.swift", status: .done),
            .assistant("The formatting is fixed."),
        ]
        XCTAssertEqual(TranscriptView.debugGroupedRowActionFlags(items, isTurnActive: true), [false, false, false, false])
        XCTAssertEqual(TranscriptView.debugGroupedRowActionFlags(items, isTurnActive: false), [false, true])
    }

    func testPriorTurnActionsRemainVisibleWhileANewTurnStreams() {
        let items: [TranscriptItem] = [
            .user("First request"), .assistant("First answer"),
            .user("Follow-up"), .assistant("Checking that now."),
            .assistant("New answer", streaming: true),
        ]
        XCTAssertEqual(TranscriptView.debugGroupedRowActionFlags(items, isTurnActive: true), [false, true, false, false, false])
        XCTAssertEqual(TranscriptView.debugGroupedRowActionFlags(items, isTurnActive: false), [false, true, false, true])
    }


    func testSettledTurnFoldsAllCommentaryAndTrailingToolsAboveTheFinalAnswer() {
        let items: [TranscriptItem] = [
            .user("Fix it"), .assistant("Inspecting the code."),
            .tool(id: "read", name: "read", context: "src/Chat.tsx", status: .done),
            .assistant("Applying the fix."), .assistant("Fixed and verified."),
            .tool(id: "late", name: "test", context: "Tests passed", status: .done),
        ]
        XCTAssertEqual(TranscriptView.debugGroupedRowCounts(items), [1, 5])
        XCTAssertEqual(TranscriptView.debugGroupedRowFoldedActivityCounts(items), [0, 4])
        XCTAssertEqual(TranscriptView.debugGroupedRowActionFlags(items, isTurnActive: false), [false, true])
        XCTAssertEqual(TranscriptView.debugGroupedRowActionFlags(items, isTurnActive: true).count, 6)
        // Folding is presentation only: every original message remains intact.
        XCTAssertEqual(items[1].text, "Inspecting the code.")
        XCTAssertEqual(items[4].text, "Fixed and verified.")
    }

    func testTurnSummaryDurationUsesHostTimesAcrossSnapshotReconciliation() {
        let first = TranscriptItem.assistant("Inspecting")
        first.createdAt = 1000
        first.completedAt = 2000
        let last = TranscriptItem.assistant("Done")
        last.createdAt = 62_000
        last.completedAt = 81_000
        XCTAssertEqual(ToolActivityStrip.turnSummaryPhrase(for: [first, last]), "Worked for 1m 20s")
        let reloaded = TranscriptItem.assistant("Done")
        reloaded.createdAt = 62_000
        reloaded.completedAt = 81_000
        last.absorb(reloaded)
        XCTAssertEqual(ToolActivityStrip.turnSummaryPhrase(for: [first, last]), "Worked for 1m 20s")
    }

    func testLiveStatusNeverDropsBetweenNarrationThinkingAndToolFrames() {
        let chat = makeChat()
        let frames = [
            event(id: "start", cursor: 1, kind: "run.status", runId: "r1", runStatus: "running"),
            event(id: "preamble", cursor: 2, kind: "assistant.delta", runId: "r1", text: "Inspecting the code"),
            event(id: "preamble", cursor: 3, kind: "assistant.message", runId: "r1", text: "Inspecting the code."),
            event(id: "read", cursor: 4, kind: "tool.start", runId: "r1", toolName: "read"),
            event(id: "read", cursor: 5, kind: "tool.end", runId: "r1", toolName: "read"),
            event(id: "thought", cursor: 6, kind: "thinking.delta", runId: "r1", text: "Checking the result"),
            event(id: "answer", cursor: 7, kind: "assistant.delta", runId: "r1", text: "Fixed"),
            event(id: "answer", cursor: 8, kind: "assistant.message", runId: "r1", text: "Fixed."),
        ]
        for frame in frames {
            chat.fold(frame)
            XCTAssertNotNil(chat.liveStatusText, frame.kind)
        }
        chat.fold(event(id: "end", cursor: 9, kind: "run.status", runId: "r1", runStatus: "completed"))
        XCTAssertNil(chat.liveStatusText)
        chat.fold(event(id: "read", cursor: 10, kind: "tool.update", runId: "r1", toolName: "read"))
        XCTAssertNil(chat.liveStatusText)
    }

    func testFoldIgnoresDelayedToolEndAfterRunCompletes() {
        let chat = makeChat()
        chat.fold(event(id: "start", cursor: 1, kind: "tool.start", runId: "r1", toolName: "read"))
        chat.fold(event(id: "done", cursor: 2, kind: "run.status", runId: "r1", runStatus: "completed"))
        XCTAssertEqual(chat.items.count, 1)
        XCTAssertEqual(chat.items.first?.toolStatus, .done)
        chat.fold(event(id: "late", cursor: 3, kind: "tool.end", runId: "r1", toolName: "read"))
        XCTAssertEqual(chat.items.count, 1)
        XCTAssertEqual(chat.items.first?.toolStatus, .done)
    }

    // MARK: Itemization

    func testItemizeBuildsUserAssistantAndToolRows() {
        let items = ChatModel.itemize([
            event(id: "e1", cursor: 1, kind: "user.message", text: "Fix the bug"),
            event(id: "e2", cursor: 2, kind: "tool.end", text: "npm test", toolName: "bash"),
            event(id: "e3", cursor: 3, kind: "assistant.message", text: "Done — tests pass."),
        ])

        XCTAssertEqual(items.count, 3)
        XCTAssertEqual(items[0].kind, .user)
        XCTAssertEqual(items[0].text, "Fix the bug")
        XCTAssertEqual(items[1].kind, .tool)
        XCTAssertEqual(items[1].toolName, "bash")
        XCTAssertEqual(items[1].toolStatus, .done)
        XCTAssertEqual(items[2].kind, .assistant)
        XCTAssertEqual(items[2].text, "Done — tests pass.")
    }

    func testItemizeKeepsStreamingTailStreaming() {
        let items = ChatModel.itemize([
            event(id: "e1", cursor: 1, kind: "user.message", text: "Go"),
            event(id: "e2", cursor: 2, kind: "thinking.delta", text: "Considering approach"),
            event(id: "e3", cursor: 3, kind: "assistant.delta", text: "Working on"),
        ])

        XCTAssertEqual(items.count, 3)
        XCTAssertEqual(items[1].reasoning, "Considering approach")
        XCTAssertFalse(items[1].isStreaming)
        XCTAssertTrue(items[2].isStreaming)
        XCTAssertEqual(items[2].text, "Working on")
    }

    func testItemizeSettlesAssistantOnCompleteMessage() {
        let items = ChatModel.itemize([
            event(id: "e1", cursor: 1, kind: "assistant.delta", text: "Partial"),
            event(id: "e1", cursor: 2, kind: "assistant.message", text: "Partial plus final"),
        ])

        XCTAssertEqual(items.count, 1)
        XCTAssertFalse(items[0].isStreaming)
        XCTAssertEqual(items[0].text, "Partial plus final")
    }

    func testItemizeDedupesToolRowsByEventId() {
        let items = ChatModel.itemize([
            event(id: "tool-1", cursor: 1, kind: "tool.start", text: "ls", toolName: "bash"),
            event(id: "tool-1", cursor: 2, kind: "tool.end", text: "ls", toolName: "bash"),
        ])

        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].toolStatus, .done)
    }

    // MARK: Live folding

    func testFoldAssistantDeltaCarriesFullAccumulatedText() {
        let chat = makeChat()
        chat.fold(event(id: "d1", cursor: 1, kind: "assistant.delta", text: "Hello"))
        chat.fold(event(id: "d1", cursor: 2, kind: "assistant.delta", text: "Hello world"))

        XCTAssertEqual(chat.items.count, 1)
        XCTAssertEqual(chat.items[0].text, "Hello world")
        XCTAssertTrue(chat.items[0].isStreaming)
        XCTAssertTrue(chat.isStreaming)
    }

    func testFoldAssistantMessageSettlesTurnRow() {
        let chat = makeChat()
        chat.fold(event(id: "d1", cursor: 1, kind: "assistant.delta", text: "Hi"))
        chat.fold(event(id: "d1", cursor: 2, kind: "assistant.message", text: "Hi there"))

        XCTAssertEqual(chat.items.count, 1)
        XCTAssertEqual(chat.items[0].text, "Hi there")
        XCTAssertFalse(chat.items[0].isStreaming)
    }

    func testFoldSkipsStaleCursors() {
        let chat = makeChat()
        chat.fold(event(id: "d1", cursor: 5, kind: "assistant.delta", text: "Newest"))
        chat.fold(event(id: "d0", cursor: 3, kind: "assistant.delta", text: "Stale"))

        XCTAssertEqual(chat.items[0].text, "Newest")
    }

    func testFoldUserEchoDoesNotDuplicateLastUserRow() {
        let chat = makeChat()
        // First frame stands in for the optimistic row `send` appends; the
        // second is the host echoing the same turn back.
        chat.fold(event(id: "u1", cursor: 1, kind: "user.message", text: "Ship it"))
        chat.fold(event(id: "u1", cursor: 2, kind: "user.message", text: "Ship it"))

        XCTAssertEqual(chat.items.filter { $0.kind == .user }.count, 1)
    }

    func testFoldToolStartSetsActionStatusText() {
        let chat = makeChat()
        chat.fold(event(id: "t1", cursor: 1, kind: "tool.start", text: "ls", toolName: "bash"))
        XCTAssertEqual(chat.statusText, "Running a command")

        chat.fold(event(id: "t1", cursor: 2, kind: "tool.end", text: "ls", toolName: "bash"))
        XCTAssertNil(chat.statusText)
    }

    func testFoldToolEndClearsStatusTextWhenToolNameIsOmitted() {
        let chat = makeChat()
        chat.fold(event(id: "t1", cursor: 1, kind: "tool.start", text: "ls", toolName: "bash"))
        XCTAssertEqual(chat.statusText, "Running a command")

        chat.fold(event(id: "t1", cursor: 2, kind: "tool.end", text: "ls"))
        XCTAssertNil(chat.statusText)
    }

    func testFoldRunCompletionSettlesStreaming() {
        let chat = makeChat()
        chat.fold(event(id: "d1", cursor: 1, kind: "assistant.delta", runId: "r1", text: "Reply"))
        XCTAssertTrue(chat.isStreaming)

        chat.fold(event(id: "r1", cursor: 2, kind: "run.status", runId: "r1", runStatus: "completed"))
        XCTAssertFalse(chat.isStreaming)
        XCTAssertFalse(chat.items[0].isStreaming)
    }

    func testFinalResponseSignalsCompletionOncePerTurn() {
        let chat = makeChat()
        chat.fold(event(id: "start", cursor: 1, kind: "run.status", runId: "r1", runStatus: "running"))
        chat.fold(event(id: "work", cursor: 2, kind: "assistant.message", runId: "r1", text: "Checking…"))
        XCTAssertEqual(chat.responseCompletionTick, 0, "An intermediate message is not a final reply.")
        chat.fold(event(id: "answer", cursor: 3, kind: "assistant.message", runId: "r1", text: "Done."))
        chat.fold(event(id: "end", cursor: 4, kind: "run.status", runId: "r1", runStatus: "completed"))
        XCTAssertEqual(chat.responseCompletionTick, 1, "Short replies without text deltas still get feedback.")
        chat.fold(event(id: "duplicate", cursor: 5, kind: "run.status", runId: "r1", runStatus: "completed"))
        chat.fold(event(id: "idle", cursor: 6, kind: "run.status", runStatus: "completed"))
        XCTAssertEqual(chat.responseCompletionTick, 1)
        chat.fold(event(id: "next", cursor: 7, kind: "assistant.delta", runId: "r2", text: "Next answer."))
        chat.fold(event(id: "tool", cursor: 8, kind: "tool.end", runId: "r2", toolName: "read"))
        chat.fold(event(id: "end2", cursor: 9, kind: "run.status", runId: "r2", runStatus: "completed"))
        XCTAssertEqual(chat.responseCompletionTick, 2)
    }

    func testCancelledFailedAndToolOnlyTurnsDoNotSignalResponseCompletion() {
        for status in ["cancelled", "failed", "error"] {
            let chat = makeChat()
            chat.fold(event(id: "partial", cursor: 1, kind: "assistant.delta", runId: "r1", text: "Partial answer"))
            chat.fold(event(id: "end", cursor: 2, kind: "run.status", runId: "r1", runStatus: status))
            XCTAssertEqual(chat.responseCompletionTick, 0)
        }
        let chat = makeChat()
        chat.fold(event(id: "tool", cursor: 1, kind: "tool.start", runId: "r1", toolName: "read"))
        chat.fold(event(id: "end", cursor: 2, kind: "run.status", runId: "r1", runStatus: "completed"))
        XCTAssertEqual(chat.responseCompletionTick, 0)
    }

    func testHistoryAndUnrelatedRunCompletionStaySilent() {
        let chat = makeChat()
        chat.applySnapshot(snapshot(events: [
            event(id: "answer", cursor: 1, kind: "assistant.message", runId: "r1", text: "Old answer"),
            event(id: "end", cursor: 2, kind: "run.status", runId: "r1", runStatus: "completed"),
        ], cursor: 2))
        XCTAssertEqual(chat.responseCompletionTick, 0)
        chat.fold(event(id: "next", cursor: 3, kind: "assistant.delta", runId: "r2", text: "Current answer"))
        chat.fold(event(id: "old", cursor: 4, kind: "run.status", runId: "r1", runStatus: "completed"))
        XCTAssertEqual(chat.responseCompletionTick, 0)
        XCTAssertTrue(chat.isStreaming)
    }

    func testFoldApprovalLifecycle() {
        let chat = makeChat()
        chat.fold(event(
            id: "p1", cursor: 1, kind: "approval.requested",
            text: "Run rm -rf build", toolName: "bash", approvalId: "a1"
        ))
        XCTAssertEqual(chat.pendingApproval?.approvalID, "a1")
        XCTAssertEqual(chat.pendingApproval?.command, "bash")

        chat.fold(event(id: "p2", cursor: 2, kind: "approval.resolved", approvalId: "a1"))
        XCTAssertNil(chat.pendingApproval)
    }

    func testFoldQuestionLifecycle() {
        let chat = makeChat()
        chat.fold(event(
            id: "q-ev", cursor: 1, kind: "question.requested",
            text: "Which database?", questionId: "q1"
        ))
        XCTAssertEqual(chat.pendingClarify?.requestID, "q1")
        XCTAssertEqual(chat.pendingClarify?.question, "Which database?")

        chat.fold(event(id: "q-done", cursor: 2, kind: "question.resolved", questionId: "q1"))
        XCTAssertNil(chat.pendingClarify)
    }

    func testFoldErrorAppendsSingleErrorRow() {
        let chat = makeChat()
        chat.fold(event(id: "e1", cursor: 1, kind: "error", text: "Engine crashed"))
        chat.fold(event(id: "e2", cursor: 2, kind: "error", text: "Engine crashed"))

        XCTAssertEqual(chat.items.filter { $0.kind == .error }.count, 1)
    }

    func testFoldIgnoresOtherThreads() {
        let chat = makeChat()
        chat.fold(event(id: "d1", cursor: 1, kind: "assistant.delta", threadId: "other", text: "Hi"))
        // ChatModel itself doesn't filter by thread (AppModel routes), but the
        // event still folds — this documents that routing is the caller's job.
        XCTAssertEqual(chat.items.count, 1)
    }

    // MARK: Snapshot reconcile

    private func snapshot(
        events: [TimelineEvent],
        cursor: Int,
        approvals: [PendingApproval] = [],
        questions: [PendingQuestion] = [],
        runs: [ActiveRun] = []
    ) -> EnvironmentSnapshot {
        EnvironmentSnapshot(
            environment: EnvironmentInfo(
                id: "env1", label: "Mac", hostVersion: nil,
                protocolVersion: 1, capabilities: [], cursor: cursor
            ),
            projects: [],
            threads: [],
            activeRuns: runs,
            pendingApprovals: approvals,
            pendingQuestions: questions,
            selectedTranscript: TranscriptContainer(threadId: "t1", cursor: cursor, events: events),
            cursor: cursor
        )
    }

    func testApplySnapshotPreservesRowIdentityAcrossReconcile() {
        let chat = makeChat()
        chat.applySnapshot(snapshot(
            events: [
                event(id: "e1", cursor: 1, kind: "user.message", text: "Hello"),
                event(id: "e2", cursor: 2, kind: "assistant.message", text: "Hi! How can I help?"),
            ],
            cursor: 2
        ))
        XCTAssertEqual(chat.items.count, 2)
        let originalIDs = chat.items.map(\.id)

        chat.applySnapshot(snapshot(
            events: [
                event(id: "e1", cursor: 1, kind: "user.message", text: "Hello"),
                event(id: "e2", cursor: 2, kind: "assistant.message", text: "Hi! How can I help?"),
                event(id: "e3", cursor: 3, kind: "user.message", text: "Add a test"),
            ],
            cursor: 3
        ))
        XCTAssertEqual(chat.items.count, 3)
        XCTAssertEqual(Array(chat.items.prefix(2).map(\.id)), originalIDs)
    }

    func testApplySnapshotIgnoresOlderTranscript() {
        let chat = makeChat()
        chat.fold(event(id: "d1", cursor: 10, kind: "assistant.delta", text: "Live and ahead"))

        chat.applySnapshot(snapshot(
            events: [event(id: "e1", cursor: 1, kind: "assistant.message", text: "Old reply")],
            cursor: 5
        ))
        XCTAssertEqual(chat.items.count, 1)
        XCTAssertEqual(chat.items[0].text, "Live and ahead")
    }

    func testApplySnapshotDrivesPendingInteractions() {
        let chat = makeChat()
        chat.applySnapshot(snapshot(
            events: [],
            cursor: 1,
            approvals: [PendingApproval(
                id: "a1", threadId: "t1", title: "Run bash", detail: "rm -rf build", createdAt: 0
            )],
            questions: [PendingQuestion(
                id: "q1", threadId: "t1", runId: nil, prompt: "Which db?",
                options: [QuestionOption(id: "opt1", label: "Postgres")],
                allowFreeform: true, createdAt: 0
            )]
        ))
        XCTAssertEqual(chat.pendingApproval?.approvalID, "a1")
        XCTAssertEqual(chat.pendingClarify?.requestID, "q1")
        XCTAssertEqual(chat.pendingClarify?.choices, ["Postgres"])
        XCTAssertEqual(chat.pendingClarify?.choiceIDs, ["opt1"])

        chat.applySnapshot(snapshot(events: [], cursor: 2))
        XCTAssertNil(chat.pendingApproval)
        XCTAssertNil(chat.pendingClarify)
    }

    func testApplySnapshotTracksRunActivity() {
        let chat = makeChat()
        chat.applySnapshot(snapshot(
            events: [],
            cursor: 1,
            runs: [ActiveRun(id: "r1", threadId: "t1", status: "running", startedAt: 0)]
        ))
        XCTAssertTrue(chat.isStreaming)

        chat.applySnapshot(snapshot(
            events: [],
            cursor: 2,
            runs: [ActiveRun(id: "r1", threadId: "t1", status: "completed", startedAt: 0)]
        ))
        XCTAssertFalse(chat.isStreaming)
    }

    func testStreamingTailRebindsAfterReconcile() {
        let chat = makeChat()
        chat.applySnapshot(snapshot(
            events: [event(id: "d1", cursor: 1, kind: "assistant.delta", runId: "r1", text: "Stream")],
            cursor: 1,
            runs: [ActiveRun(id: "r1", threadId: "t1", status: "running", startedAt: 0)]
        ))
        XCTAssertTrue(chat.items[0].isStreaming)

        // A later live delta must keep updating the SAME row, not mint another.
        chat.fold(event(id: "d1", cursor: 2, kind: "assistant.delta", text: "Streaming more"))
        XCTAssertEqual(chat.items.count, 1)
        XCTAssertEqual(chat.items[0].text, "Streaming more")
    }
    func testLiveReplyKeepsIdentityWhenSavedTextGrows() {
        let chat = makeChat()
        chat.fold(event(id: "reply:delta:5", cursor: 1, kind: "assistant.delta", text: "Hello"))
        let identity = chat.items[0].id
        chat.applySnapshot(snapshot(events: [event(id: "reply", cursor: 2, kind: "assistant.message", text: "Hello there")], cursor: 2))
        XCTAssertEqual(chat.items.count, 1)
        XCTAssertEqual(chat.items[0].id, identity)
        XCTAssertEqual(chat.items[0].text, "Hello there")
        XCTAssertFalse(chat.items[0].isStreaming)
    }

    func testSeparateRepliesAreNotOverwrittenOrDeduplicatedByText() {
        let chat = makeChat()
        chat.fold(event(id: "commentary", cursor: 1, kind: "assistant.delta", text: "Checking"))
        chat.fold(event(id: "answer", cursor: 2, kind: "assistant.delta", text: "Done"))
        chat.fold(event(id: "commentary", cursor: 3, kind: "assistant.message", text: "Checking"))
        chat.fold(event(id: "answer", cursor: 4, kind: "assistant.message", text: "Done"))
        chat.fold(event(id: "another", cursor: 5, kind: "assistant.message", text: "Done"))
        XCTAssertEqual(chat.items.map(\.text), ["Checking", "Done", "Done"])
    }


    func testCompletionClearsEveryReasoningAndToolIndicator() {
        let chat = makeChat()
        chat.fold(event(id: "thinking", cursor: 1, kind: "thinking.delta", runId: "r1", text: "Checking"))
        XCTAssertNotNil(chat.liveStatusText)
        chat.fold(event(id: "tool", cursor: 2, kind: "tool.start", runId: "r1", toolName: "read"))
        chat.fold(event(id: "reply", cursor: 3, kind: "assistant.delta", runId: "r1", text: "Here is the answer"))
        XCTAssertNotNil(chat.liveStatusText)
        chat.fold(event(id: "reply", cursor: 4, kind: "assistant.message", runId: "r1", text: "Here is the answer."))
        chat.fold(event(id: "done", cursor: 5, kind: "run.status", runId: "r1", runStatus: "completed"))
        XCTAssertFalse(chat.isStreaming)
        XCTAssertNil(chat.liveStatusText)
        XCTAssertTrue(chat.items.allSatisfy { !$0.isStreaming && $0.toolStatus != .running })
        XCTAssertTrue(chat.items.allSatisfy { $0.reasoningStartedAt == nil })
    }

    func testHistoryTerminalStatusSettlesAllRowsAndIgnoresReplayedThinking() {
        let events = [
            event(id: "thought", cursor: 1, kind: "thinking.delta", runId: "r1", text: "Checking"),
            event(id: "tool", cursor: 2, kind: "tool.start", runId: "r1", toolName: "read"),
            event(id: "done", cursor: 3, kind: "run.status", runId: "r1", runStatus: "completed"),
            event(id: "thought", cursor: 4, kind: "thinking.delta", runId: "r1", text: "Checking again"),
        ]
        let items = ChatModel.itemize(events)
        XCTAssertEqual(items.count, 2)
        XCTAssertTrue(items.allSatisfy { !$0.isStreaming && $0.toolStatus != .running })
        XCTAssertEqual(items[0].reasoning, "Checking")
    }

    func testCompletionWhileOfflineSettlesSnapshotFlags() {
        let chat = makeChat()
        let thought = event(id: "thought", cursor: 1, kind: "thinking.delta", runId: "r1", text: "Checking")
        chat.fold(thought)
        let identity = chat.items[0].id
        // Persisted reasoning is still represented as a delta, but the run is gone.
        chat.applySnapshot(snapshot(events: [thought], cursor: 3))
        XCTAssertEqual(chat.items[0].id, identity)
        XCTAssertFalse(chat.items[0].isStreaming)
        XCTAssertFalse(chat.isStreaming)
        XCTAssertNil(chat.liveStatusText)
        XCTAssertNil(chat.items[0].reasoningStartedAt)
    }

    func testCompletedRunCannotRestartOnLateFramesOrStaleSnapshot() {
        let chat = makeChat()
        chat.fold(event(id: "reply", cursor: 10, kind: "assistant.delta", runId: "r1", text: "Answer"))
        chat.fold(event(id: "done", cursor: 11, kind: "run.status", runId: "r1", runStatus: "completed"))
        chat.applySnapshot(snapshot(events: [], cursor: 9,
            runs: [ActiveRun(id: "r1", threadId: "t1", status: "running", startedAt: 0)]))
        chat.fold(event(id: "thought", cursor: 12, kind: "thinking.delta", runId: "r1", text: "Old thought"))
        chat.fold(event(id: "running", cursor: 13, kind: "run.status", runId: "r1", runStatus: "running"))
        XCTAssertEqual(chat.items.map(\.text), ["Answer"])
        XCTAssertFalse(chat.isStreaming)
        XCTAssertNil(chat.liveStatusText)
    }

    func testOlderRunCompletionDoesNotStopNewRun() {
        let chat = makeChat()
        chat.fold(event(id: "new", cursor: 1, kind: "assistant.delta", runId: "new-run", text: "New reply"))
        chat.fold(event(id: "old", cursor: 2, kind: "run.status", runId: "old-run", runStatus: "completed"))
        XCTAssertTrue(chat.isStreaming)
        XCTAssertTrue(chat.items[0].isStreaming)
    }

    func testFinalMessageRejectsDelayedPrefixInLiveAndHistory() {
        let events = [
            event(id: "reply:complete", cursor: 1, kind: "assistant.message", text: "    final code\n"),
            event(id: "reply:delta:2", cursor: 2, kind: "assistant.delta", text: "    final"),
        ]
        let chat = makeChat()
        events.forEach(chat.fold)
        for items in [chat.items, ChatModel.itemize(events)] {
            XCTAssertEqual(items.count, 1)
            XCTAssertEqual(items[0].text, "    final code\n")
            XCTAssertFalse(items[0].isStreaming)
        }
    }

    func testErrorStopsThinkingAndRunningTools() {
        let chat = makeChat()
        chat.fold(event(id: "tool", cursor: 1, kind: "tool.start", runId: "r1", toolName: "read"))
        chat.fold(event(id: "error", cursor: 2, kind: "error", runId: "r1", text: "Disconnected from provider"))
        XCTAssertFalse(chat.isStreaming)
        XCTAssertNil(chat.liveStatusText)
        XCTAssertEqual(chat.items[0].toolStatus, .failed)
    }

    func testIdenticalUserMessagesAreSeparateTurns() {
        let chat = makeChat()
        chat.fold(event(id: "u1", cursor: 1, kind: "user.message", text: "Continue"))
        chat.fold(event(id: "u2", cursor: 2, kind: "user.message", text: "Continue"))
        XCTAssertEqual(chat.items.count, 2)
    }

    func testToolUpdateDoesNotSettleConcurrentAnswer() {
        let chat = makeChat()
        chat.fold(event(id: "tool", cursor: 1, kind: "tool.start", runId: "r1", toolName: "read"))
        chat.fold(event(id: "reply", cursor: 2, kind: "assistant.delta", runId: "r1", text: "Answer"))
        chat.fold(event(id: "tool", cursor: 3, kind: "tool.update", runId: "r1", toolName: "read"))
        XCTAssertTrue(chat.items[1].isStreaming)
        XCTAssertEqual(chat.liveStatusText, "Reading files")
    }

    func testProviderLocksAfterUserMessageAndStaysLockedOnCompletion() {
        let chat = makeChat()
        XCTAssertFalse(chat.canChangeProvider, "Unknown history must not enable a provider switch")
        chat.applySnapshot(snapshot(events: [], cursor: 0))
        XCTAssertTrue(chat.canChangeProvider)
        chat.fold(event(id: "user", cursor: 1, kind: "user.message", runId: "r1", text: "Hello"))
        XCTAssertFalse(chat.canChangeProvider)
        chat.fold(event(id: "done", cursor: 2, kind: "run.status", runId: "r1", runStatus: "completed"))
        XCTAssertFalse(chat.canChangeProvider)
    }

    func testProviderLocksForRestoredChat() {
        let chat = makeChat()
        chat.applyCachedTranscript(TranscriptContainer(threadId: "t1", cursor: 1,
            events: [event(id: "user", cursor: 1, kind: "user.message", text: "Hello")]))
        XCTAssertFalse(chat.canChangeProvider)
    }

}
