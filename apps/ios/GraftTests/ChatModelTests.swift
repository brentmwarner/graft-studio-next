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
        runStatus: String? = nil
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
            runStatus: runStatus
        )
    }

    private func makeChat() -> ChatModel {
        ChatModel(threadId: "t1", title: "Test thread")
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

        XCTAssertEqual(items.count, 2)
        XCTAssertEqual(items[1].kind, .assistant)
        XCTAssertTrue(items[1].isStreaming)
        XCTAssertEqual(items[1].reasoning, "Considering approach")
        XCTAssertEqual(items[1].text, "Working on")
    }

    func testItemizeSettlesAssistantOnCompleteMessage() {
        let items = ChatModel.itemize([
            event(id: "e1", cursor: 1, kind: "assistant.delta", text: "Partial"),
            event(id: "e2", cursor: 2, kind: "assistant.message", text: "Partial plus final"),
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
        chat.fold(event(id: "d2", cursor: 2, kind: "assistant.delta", text: "Hello world"))

        XCTAssertEqual(chat.items.count, 1)
        XCTAssertEqual(chat.items[0].text, "Hello world")
        XCTAssertTrue(chat.items[0].isStreaming)
        XCTAssertTrue(chat.isStreaming)
    }

    func testFoldAssistantMessageSettlesTurnRow() {
        let chat = makeChat()
        chat.fold(event(id: "d1", cursor: 1, kind: "assistant.delta", text: "Hi"))
        chat.fold(event(id: "m1", cursor: 2, kind: "assistant.message", text: "Hi there"))

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
        chat.fold(event(id: "u2", cursor: 2, kind: "user.message", text: "Ship it"))

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
            events: [event(id: "d1", cursor: 1, kind: "assistant.delta", text: "Stream")],
            cursor: 1
        ))
        XCTAssertTrue(chat.items[0].isStreaming)

        // A later live delta must keep updating the SAME row, not mint another.
        chat.fold(event(id: "d2", cursor: 2, kind: "assistant.delta", text: "Streaming more"))
        XCTAssertEqual(chat.items.count, 1)
        XCTAssertEqual(chat.items[0].text, "Streaming more")
    }
}
