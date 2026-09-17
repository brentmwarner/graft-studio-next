import XCTest
@testable import Graft

@MainActor
final class TaskProgressTests: XCTestCase {
    private func event(_ cursor: Int, kind: String = "todo.update", run: String = "run-1", statuses: [TimelineTaskData.Todo.Status]? = nil) -> TimelineEvent {
        TimelineEvent(
            id: "event-\(cursor)", cursor: cursor, kind: kind, threadId: "thread-1", runId: run,
            createdAt: cursor, text: kind == "user.message" ? "Work on this" : nil,
            toolName: nil, approvalId: nil, questionId: nil, diffId: nil, runStatus: nil,
            data: statuses.map { statuses in
                TimelineTaskData(type: "todo_update", todos: statuses.enumerated().map {
                    .init(id: "task-\($0.offset)", text: "Task \($0.offset)", status: $0.element)
                })
            }
        )
    }

    func testUpdatesKeepIdentityAndMatchReplay() throws {
        let events = [event(1, kind: "user.message"), event(2, statuses: [.completed, .in_progress]), event(3, statuses: [.completed, .completed])]
        var state = TaskProgressState()
        state.fold(events[0])
        state.fold(events[1])
        let first = try XCTUnwrap(state.visible)
        state.fold(events[2])
        XCTAssertEqual(state.visible?.id, first.id)
        XCTAssertEqual(state.visible?.items.map(\.id), first.items.map(\.id))
        XCTAssertEqual(state.visible?.completedCount, 2)
        XCTAssertEqual(state, .replay(events))
    }

    func testUnfinishedTasksCarryAcrossTurnsButCompletedTasksDoNot() {
        var state = TaskProgressState.replay([event(1, kind: "user.message"), event(2, statuses: [.completed, .pending])])
        state.fold(event(3, kind: "user.message", run: "run-2"))
        XCTAssertEqual(state.visible?.completedCount, 1)
        state.fold(event(4, run: "run-2", statuses: [.completed, .completed]))
        XCTAssertTrue(state.visible?.isComplete == true)
        state.fold(event(5, kind: "user.message", run: "run-3"))
        XCTAssertNil(state.visible)
    }

    func testCurrentTurnWinsOverLatePriorUpdateAndEmptyClears() {
        var state = TaskProgressState.replay([
            event(1, kind: "user.message"), event(2, statuses: [.pending]),
            event(3, kind: "user.message", run: "run-2"), event(4, run: "run-2", statuses: [.in_progress]),
        ])
        state.fold(event(5, statuses: [.completed]))
        XCTAssertEqual(state.visible?.id, "run-2")
        XCTAssertEqual(state.visible?.items.first?.status, .active)
        state.fold(event(6, run: "run-2", statuses: []))
        XCTAssertNil(state.visible)
    }

    func testMalformedOrUnknownPayloadDoesNotBreakEventOrEraseTasks() throws {
        var state = TaskProgressState.replay([event(1, statuses: [.pending])])
        for data in [#"{"type":"future_data","value":123}"#, #"{"type":"todo_update","todos":"invalid"}"#, #"[1,2]"#] {
            let json = #"{"id":"next","cursor":2,"kind":"todo.update","threadId":"thread-1","runId":"run-1","createdAt":2,"data":\#(data)}"#
            let decoded = try JSONDecoder().decode(TimelineEvent.self, from: Data(json.utf8))
            XCTAssertNil(decoded.data?.items)
            state.fold(decoded)
            XCTAssertEqual(state.visible?.items.count, 1)
        }
    }

    func testPlanPayloadSurvivesCacheRoundTripAndDeduplicatesIDs() throws {
        let json = #"{"id":"plan","cursor":1,"kind":"plan.update","createdAt":1,"data":{"type":"plan","title":"Release","steps":[{"id":"a","title":"Check","status":"done"},{"id":"a","title":"Duplicate","status":"pending"},{"id":"b","title":"Ship","status":"active"}]}}"#
        let event = try JSONDecoder().decode(TimelineEvent.self, from: Data(json.utf8))
        let cached = try JSONDecoder().decode(TimelineEvent.self, from: JSONEncoder().encode(event))
        XCTAssertEqual(cached, event)
        let progress = try XCTUnwrap(TaskProgressState.replay([cached]).visible)
        XCTAssertEqual(progress.title, "Release")
        XCTAssertEqual(progress.items.map(\.id), ["a", "b"])
    }

    func testTaskUpdatesNeverRestartStreamingOrInsertTranscriptRows() {
        let chat = ChatModel(threadId: "thread-1", title: "Tasks")
        chat.fold(event(1, statuses: [.in_progress, .pending]))
        XCTAssertEqual(chat.taskProgress?.items.count, 2)
        XCTAssertFalse(chat.isStreaming)
        XCTAssertNil(chat.liveStatusText)
        XCTAssertTrue(chat.items.isEmpty)
        chat.fold(event(2, statuses: [.completed, .completed]))
        XCTAssertTrue(chat.taskProgress?.isComplete == true)
        XCTAssertFalse(chat.isStreaming)
        chat.fold(event(1, statuses: [.pending]))
        XCTAssertEqual(chat.taskProgress?.completedCount, 2)
    }

    func testCachedTranscriptRestoresTaskProgress() {
        let chat = ChatModel(threadId: "thread-1", title: "Tasks")
        chat.applyCachedTranscript(TranscriptContainer(threadId: "thread-1", cursor: 2, events: [event(1, kind: "user.message"), event(2, statuses: [.completed, .pending])]))
        XCTAssertEqual(chat.taskProgress?.completedCount, 1)
        XCTAssertEqual(chat.taskProgress?.items.count, 2)
    }
}
