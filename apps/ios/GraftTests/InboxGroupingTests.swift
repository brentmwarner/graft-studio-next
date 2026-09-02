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
                    id: "t3",
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
        XCTAssertTrue(groups[0].threads[0].showsAttentionDot)
        XCTAssertFalse(groups[0].threads[1].showsAttentionDot)
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
        XCTAssertTrue(recents[0].showsAttentionDot)
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
