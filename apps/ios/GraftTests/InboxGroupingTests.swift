import XCTest
@testable import Graft

final class InboxGroupingTests: XCTestCase {
    func testGroupsThreadsUnderProjectsAndMarksAttention() {
        let snapshot = EnvironmentSnapshot(
            environment: EnvironmentInfo(
                id: "env",
                label: "Mac",
                hostVersion: "1",
                protocolVersion: 1,
                capabilities: [],
                cursor: 1
            ),
            projects: [
                ProjectInfo(id: "p1", name: "graft-studio", kind: "repo", path: "/tmp/g"),
                ProjectInfo(id: "p2", name: "fetch", kind: "repo", path: "/tmp/f"),
            ],
            threads: [
                ThreadInfo(
                    id: "t1",
                    projectId: "p1",
                    title: "Audit Graft",
                    updatedAt: 1,
                    status: "running"
                ),
                ThreadInfo(
                    id: "t2",
                    projectId: "p1",
                    title: "Plan mobile",
                    updatedAt: 2,
                    status: "idle"
                ),
                ThreadInfo(
                    id: "t9",
                    projectId: "p2",
                    title: "Fix notifications",
                    updatedAt: 3,
                    status: "idle"
                ),
            ],
            activeRuns: [
                ActiveRun(
                    id: "r1",
                    threadId: "t1",
                    projectId: "p1",
                    status: "running",
                    startedAt: 1
                ),
            ],
            pendingApprovals: [],
            pendingQuestions: [],
            selectedTranscript: nil,
            cursor: 1
        )

        let groups = InboxGrouping.projects(from: snapshot, searchQuery: "")
        XCTAssertEqual(groups.map(\.name), ["graft-studio", "fetch"])
        XCTAssertEqual(groups[0].threads.map(\.title), ["Audit Graft", "Plan mobile"])
        XCTAssertEqual(groups[0].threads[0].activity, .working)
        XCTAssertEqual(groups[0].threads[1].activity, .idle)
    }

    func testSearchFiltersThreadTitles() {
        let snapshot = EnvironmentSnapshot(
            environment: EnvironmentInfo(
                id: "env",
                label: "Mac",
                hostVersion: "1",
                protocolVersion: 1,
                capabilities: [],
                cursor: 1
            ),
            projects: [
                ProjectInfo(id: "p1", name: "graft-studio", kind: "repo", path: "/tmp/g"),
            ],
            threads: [
                ThreadInfo(
                    id: "t1",
                    projectId: "p1",
                    title: "Audit Graft",
                    updatedAt: 1,
                    status: "idle"
                ),
                ThreadInfo(
                    id: "t2",
                    projectId: "p1",
                    title: "Plan mobile",
                    updatedAt: 2,
                    status: "idle"
                ),
            ],
            activeRuns: [],
            pendingApprovals: [],
            pendingQuestions: [],
            selectedTranscript: nil,
            cursor: 1
        )

        let groups = InboxGrouping.projects(from: snapshot, searchQuery: "mobile")
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].threads.map(\.title), ["Plan mobile"])
    }

    func testRecentThreadsRankAttentionThenRunningThenRecency() {
        let snapshot = EnvironmentSnapshot(
            environment: EnvironmentInfo(
                id: "env",
                label: "Mac",
                hostVersion: "1",
                protocolVersion: 1,
                capabilities: [],
                cursor: 1
            ),
            projects: [
                ProjectInfo(id: "p1", name: "graft-studio", kind: "repo", path: "/tmp/g"),
                ProjectInfo(id: "p2", name: "fetch", kind: "repo", path: "/tmp/f"),
            ],
            threads: [
                ThreadInfo(
                    id: "t-attention",
                    projectId: "p1",
                    title: "Approve the deploy",
                    updatedAt: 1,
                    status: "needs_attention"
                ),
                ThreadInfo(
                    id: "t-running-old",
                    projectId: "p1",
                    title: "Audit Graft",
                    updatedAt: 2,
                    status: "running"
                ),
                ThreadInfo(
                    id: "t-running-husk",
                    projectId: "p2",
                    title: "New thread",
                    updatedAt: 5,
                    status: "running"
                ),
                ThreadInfo(
                    id: "t-idle-pr",
                    projectId: "p2",
                    title: "Ship charts",
                    updatedAt: 9,
                    status: "idle",
                    pr: ThreadPrInfo(number: 207, state: .merged)
                ),
                ThreadInfo(
                    id: "t-idle-husk",
                    projectId: "p1",
                    title: "New thread",
                    updatedAt: 8,
                    status: "idle"
                ),
                ThreadInfo(
                    id: "t-idle",
                    projectId: "p2",
                    title: "Fix pairing",
                    updatedAt: 7,
                    status: "idle"
                ),
            ],
            activeRuns: [],
            pendingApprovals: [],
            pendingQuestions: [],
            selectedTranscript: nil,
            cursor: 1
        )

        let recents = InboxGrouping.recentThreads(from: snapshot)
        // Attention first, then live runs by recency (husks included while
        // active), then worked-on threads by recency; idle husks filtered.
        XCTAssertEqual(
            recents.map(\.id),
            ["t-attention", "t-running-husk", "t-running-old", "t-idle-pr", "t-idle"]
        )
        XCTAssertEqual(recents[0].activity, .needsAttention)
        XCTAssertEqual(recents[3].pr, ThreadPrInfo(number: 207, state: .merged))
        XCTAssertNil(recents[4].pr)

        let capped = InboxGrouping.recentThreads(from: snapshot, limit: 2)
        XCTAssertEqual(capped.map(\.id), ["t-attention", "t-running-husk"])

        XCTAssertEqual(InboxGrouping.recentThreads(from: nil), [])
    }

    func testThreadPrInfoDecodesKnownAndUnknownStates() throws {
        let decoder = JSONDecoder()
        let merged = try decoder.decode(
            ThreadPrInfo.self,
            from: Data(#"{"number":207,"state":"merged","url":"https://example.com/pr/207"}"#.utf8)
        )
        XCTAssertEqual(merged, ThreadPrInfo(number: 207, state: .merged, url: "https://example.com/pr/207"))

        let blocked = try decoder.decode(
            ThreadPrInfo.self,
            from: Data(#"{"number":9,"state":"changes_requested"}"#.utf8)
        )
        XCTAssertEqual(blocked.state, .changesRequested)

        // A state this build doesn't know yet must not sink the snapshot.
        let future = try decoder.decode(
            ThreadPrInfo.self,
            from: Data(#"{"number":3,"state":"locked"}"#.utf8)
        )
        XCTAssertEqual(future.state, .open)
    }
}

extension InboxGroupingTests {
    static var viewCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }

    static func viewDate(_ day: Int, hour: Int = 0) -> Date {
        viewCalendar.date(from: DateComponents(year: 2026, month: 9, day: day, hour: hour))!
    }

    static var viewFixture: EnvironmentSnapshot {
        func thread(_ id: String, _ day: Int, hour: Int = 0, status: String = "idle", project: String = "graft") -> ThreadInfo {
            ThreadInfo(id: id, projectId: project, title: id,
                       updatedAt: Int(viewDate(day, hour: hour).timeIntervalSince1970 * 1000), status: status)
        }
        return EnvironmentSnapshot(
            environment: EnvironmentInfo(id: "mac", label: "Mac", hostVersion: "1", protocolVersion: 1, capabilities: [], cursor: 1),
            projects: [ProjectInfo(id: "graft", name: "Graft", kind: "repo", path: "/graft"),
                       ProjectInfo(id: "empty", name: "Empty", kind: "repo", path: "/empty")],
            threads: [thread("old-active", 1), thread("yesterday", 19), thread("week", 13),
                      thread("older", 12, hour: 23), thread("today-midnight", 20), thread("today-newest", 20, hour: 11),
                      thread("approval", 2), thread("question", 3, project: "missing"),
                      thread("status-attention", 4, status: "needs_attention"), thread("status-running", 5, status: "running")],
            activeRuns: [ActiveRun(id: "run", threadId: "old-active", projectId: "graft", status: "running", startedAt: 1)],
            pendingApprovals: [PendingApproval(id: "approve", threadId: "approval", title: "Review", createdAt: 1)],
            pendingQuestions: [PendingQuestion(id: "ask", threadId: "question", runId: nil, prompt: "Choose", options: nil, allowFreeform: true, createdAt: 1)],
            selectedTranscript: nil, cursor: 1
        )
    }

    func testChronologicalCalendarBoundariesAndNewestFirst() {
        let sections = InboxGrouping.sections(from: Self.viewFixture, mode: .chronological, searchQuery: "",
                                               now: Self.viewDate(20, hour: 12), calendar: Self.viewCalendar)
        XCTAssertEqual(sections.map(\.title), ["Today", "Yesterday", "Previous 7 days", "Older"])
        XCTAssertEqual(sections.prefix(3).map { $0.threads.map(\.id) },
                       [["today-newest", "today-midnight"], ["yesterday"], ["week"]])
        XCTAssertEqual(Set(sections.flatMap { $0.threads.map(\.id) }).count, Self.viewFixture.threads.count)
    }

    func testPriorityRanksDecisionsBeforeRunningAndDoesNotDuplicateThreads() {
        let sections = InboxGrouping.sections(from: Self.viewFixture, mode: .priority, searchQuery: "",
                                               now: Self.viewDate(20, hour: 12), calendar: Self.viewCalendar)
        XCTAssertEqual(sections.first?.threads.map(\.id),
                       ["status-attention", "question", "approval", "status-running", "old-active"])
        XCTAssertTrue(sections.first!.threads.allSatisfy { [.working, .needsAttention].contains($0.thread.activity) })
        XCTAssertEqual(sections.flatMap(\.threads).count, Self.viewFixture.threads.count)
        XCTAssertNil(sections.first?.threads.first { $0.id == "question" }?.projectName)
    }

    func testListSearchIncludesProjectsAndOrphans() {
        XCTAssertEqual(InboxGrouping.sections(from: Self.viewFixture, mode: .priority, searchQuery: " QUESTION ").first?.threads.first?.id, "question")
        XCTAssertEqual(InboxGrouping.sections(from: Self.viewFixture, mode: .chronological, searchQuery: "graft").flatMap(\.threads).count, 9)
        XCTAssertTrue(InboxGrouping.sections(from: Self.viewFixture, mode: .chronological, searchQuery: "empty").isEmpty)
        XCTAssertTrue(InboxGrouping.sections(from: Self.viewFixture, mode: .priority, searchQuery: "no match").isEmpty)
        XCTAssertTrue(InboxGrouping.sections(from: nil, mode: .priority, searchQuery: "").isEmpty)
    }

    func testChronologyUsesCalendarDaysAcrossDaylightSaving() {
        let calendar = Self.viewCalendar
        let now = calendar.date(from: DateComponents(year: 2026, month: 3, day: 9, hour: 12))!
        let previous = calendar.date(from: DateComponents(year: 2026, month: 3, day: 8, hour: 0, minute: 30))!
        let fixture = Self.viewFixture
        let snapshot = EnvironmentSnapshot(environment: fixture.environment, projects: fixture.projects,
            threads: [ThreadInfo(id: "dst", projectId: "graft", title: "DST", updatedAt: Int(previous.timeIntervalSince1970 * 1000), status: "idle")],
            activeRuns: [], pendingApprovals: [], pendingQuestions: [], selectedTranscript: nil, cursor: 1)
        XCTAssertEqual(InboxGrouping.sections(from: snapshot, mode: .chronological, searchQuery: "", now: now, calendar: calendar).first?.title, "Yesterday")
    }
    func testUnreadReceiptSurvivesReplayAndClearsOnlyObservedCompletion() throws {
        var state = InboxReadState()
        state.completed("a", at: 20)
        XCTAssertEqual(state.unreadThreadIds, ["a"])
        state.viewed("a")
        state.completed("a", at: 19)
        state.completed("a", at: 20)
        XCTAssertTrue(state.unreadThreadIds.isEmpty)
        state.completed("a", at: 21)
        XCTAssertEqual(state.unreadThreadIds, ["a"])
        let restored = try JSONDecoder().decode(InboxReadState.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(restored, state)
    }

    func testChatsRemainSeparateWhileSearching() {
        let snapshot = EnvironmentSnapshot(environment: EnvironmentInfo(id: "env", label: "Mac", hostVersion: "1", protocolVersion: 1, capabilities: [], cursor: 1),
            projects: [ProjectInfo(id: "chat", name: "Personal", kind: "desktop", path: nil)],
            threads: [ThreadInfo(id: "t", projectId: "chat", title: "Plan weekend", updatedAt: 2, status: "idle")],
            activeRuns: [], pendingApprovals: [], pendingQuestions: [], selectedTranscript: nil, cursor: 1)
        let groups = InboxGrouping.projects(from: snapshot, searchQuery: "weekend", unreadThreadIds: ["t"])
        XCTAssertEqual(groups.first?.kind, "desktop")
        XCTAssertEqual(groups.first?.threads.first?.activity, .unread)
        let running = ThreadInfo(id: "t", projectId: "chat", title: "Plan weekend", updatedAt: 3, status: "running")
        XCTAssertEqual(InboxGrouping.item(running, snapshot: snapshot, unreadThreadIds: ["t"]).activity, .working)
    }

}
