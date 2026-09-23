import SwiftData
import Testing
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

    func testViewModePreferenceIsScopedPerComputer() {
        let suite = "inbox-view-mode-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        InboxViewPreferences.save(.priority, environmentId: "mac", defaults: defaults)
        InboxViewPreferences.save(.chronological, environmentId: "studio", defaults: defaults)
        XCTAssertEqual(InboxViewPreferences.load(environmentId: "mac", defaults: defaults), .priority)
        XCTAssertEqual(InboxViewPreferences.load(environmentId: "studio", defaults: defaults), .chronological)
        XCTAssertEqual(InboxViewPreferences.key(environmentId: "mac"), "inbox.viewMode.mac")
    }

    func testReadVisibilityIgnoresCoveredOrBackgroundTranscripts() {
        XCTAssertEqual(
            InboxReadVisibility.visibleThreadId(
                isForeground: true,
                isConversationCovered: false,
                selectedThreadId: "t",
                loadedTranscriptThreadId: "t"
            ),
            "t"
        )
        XCTAssertNil(
            InboxReadVisibility.visibleThreadId(
                isForeground: true,
                isConversationCovered: true,
                selectedThreadId: "t",
                loadedTranscriptThreadId: "t"
            )
        )
        XCTAssertNil(
            InboxReadVisibility.visibleThreadId(
                isForeground: false,
                isConversationCovered: false,
                selectedThreadId: "t",
                loadedTranscriptThreadId: "t"
            )
        )
        XCTAssertNil(
            InboxReadVisibility.visibleThreadId(
                isForeground: true,
                isConversationCovered: false,
                selectedThreadId: "t",
                loadedTranscriptThreadId: "other"
            )
        )
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

@MainActor
final class MultiMachineTests: XCTestCase {
    func testMissingRequestedMachineDoesNotFallBackToAnotherComputer() throws {
        let store = LocalStore(inMemory: true)
        try store.upsertSession(session("one"))
        let connection = ConnectionStore(store: store, environmentId: "missing")
        XCTAssertNil(connection.session)
    }

    func testAllMachinesKeepIndependentTransportsAndThreadOwnership() async throws {
        let store = LocalStore(inMemory: true)
        try seed(store, machine: "one", text: "First computer")
        try seed(store, machine: "two", text: "Second computer")
        let machines = MachineStore(store: store)
        machines.scenePhaseChanged(.background)
        defer { machines.machines.forEach { $0.stop() } }

        let one = try XCTUnwrap(machines.machine("one"))
        let two = try XCTUnwrap(machines.machine("two"))
        XCTAssertFalse(one.gateway === two.gateway)
        XCTAssertFalse(one.connection === two.connection)
        XCTAssertTrue(one.settings === two.settings)
        XCTAssertTrue(one.auth === two.auth)
        XCTAssertTrue(one.settings === machines.pairingApp.settings)
        XCTAssertFalse(machines.pairingApp.isPaired)

        await one.openThread("shared", title: "First")
        await two.openThread("shared", title: "Second")
        XCTAssertEqual(one.activeChat?.items.first?.text, "First computer")
        XCTAssertEqual(two.activeChat?.items.first?.text, "Second computer")
        XCTAssertTrue(one.activeChat?.app === one)
        XCTAssertTrue(two.activeChat?.app === two)
        one.closeThread("shared")
        XCTAssertNil(one.activeChat)
        XCTAssertEqual(two.activeChat?.threadId, "shared")
    }

    func testAllFilterNamespacesRepeatedProjectsAndThreadsAndSingleFilterKeepsOwner() throws {
        let store = LocalStore(inMemory: true)
        try seed(store, machine: "one", text: "First")
        try seed(store, machine: "two", text: "Second")
        let machines = MachineStore(store: store)
        machines.scenePhaseChanged(.background)
        defer { machines.machines.forEach { $0.stop() } }

        let all = MachineInbox(machines: machines.machines)
        let projects = all.projects(search: "")
        XCTAssertEqual(projects.count, 2)
        XCTAssertEqual(Set(projects.map(\.id)).count, 2)
        let threads = projects.flatMap(\.threads)
        XCTAssertEqual(threads.map(\.threadId), ["shared", "shared"])
        XCTAssertEqual(Set(threads.map(\.id)).count, 2)
        XCTAssertEqual(Set(threads.compactMap(\.environmentId)), ["one", "two"])
        XCTAssertEqual(Set(all.recents().map(\.id)), Set(threads.map(\.id)))

        let one = try XCTUnwrap(machines.machine("one"))
        let filtered = MachineInbox(machines: [one]).projects(search: "Project")
        XCTAssertEqual(filtered.map(\.name), ["Project"])
        XCTAssertEqual(filtered.flatMap(\.threads).map(\.environmentId), ["one"])
        XCTAssertEqual(filtered.first?.threads.first?.id, threads.first { $0.environmentId == "one" }?.id)
    }

    func testOfflineCachedWorkHasNoHistorySpinnerOrLiveStatus() async throws {
        let store = LocalStore(inMemory: true)
        try seed(store, machine: "one", text: "Cached answer", running: true)
        let app = AppModel(store: store, gateway: GatewayClient(monitorNetwork: false), environmentId: "one")
        defer { app.stop() }
        await app.openThread("shared")
        let chat = try XCTUnwrap(app.activeChat)
        XCTAssertEqual(chat.items.first?.text, "Cached answer")
        XCTAssertFalse(chat.isLoadingHistory)
        XCTAssertFalse(chat.isTurnActive)
        XCTAssertNil(chat.liveStatusText)

        let rows = MachineInbox(machines: [app]).projects(search: "").flatMap(\.threads)
        XCTAssertEqual(rows.first?.activity, .idle)
        XCTAssertFalse(MachineInbox(machines: [app]).sections(mode: .priority, search: "", now: .now)
            .contains { $0.id == "priority" })

        app.gateway.onFailure?(.unreachable("Computer is asleep"))
        XCTAssertNil(app.connectionWarning)
        app.gateway.onFailure?(.hostError(code: "host_offline", message: "Host offline", retryable: true))
        XCTAssertNil(app.connectionWarning)
        app.gateway.onFailure?(.transport(URLError(.serverCertificateUntrusted)))
        XCTAssertNotNil(app.connectionWarning)
    }

    func testOfflineThreadWithoutCachedHistoryDoesNotStartAnEndlessLoader() async throws {
        let store = LocalStore(inMemory: true)
        try store.upsertSession(session("one"))
        let app = AppModel(store: store, gateway: GatewayClient(monitorNetwork: false), environmentId: "one")
        defer { app.stop() }
        await app.openThread("uncached")
        try await Task.sleep(for: .milliseconds(320))
        XCTAssertNotNil(app.activeChat)
        XCTAssertFalse(try XCTUnwrap(app.activeChat).isLoadingHistory)
    }

    func testRePairReplacesOnlyThatRuntimeAndStaleRevocationCannotRemoveNewSession() async throws {
        let store = LocalStore(inMemory: true)
        try seed(store, machine: "one", text: "First")
        try seed(store, machine: "two", text: "Second")
        let machines = MachineStore(store: store)
        machines.scenePhaseChanged(.background)
        defer { machines.machines.forEach { $0.stop() } }
        let old = try XCTUnwrap(machines.machine("one"))
        let other = try XCTUnwrap(machines.machine("two"))
        await old.openThread("shared")
        try store.upsertSession(session("one", sessionId: "replacement"))
        machines.reload()

        let replacement = try XCTUnwrap(machines.machine("one"))
        XCTAssertFalse(replacement === old)
        XCTAssertEqual(replacement.sessionIdentity, "replacement")
        XCTAssertTrue(machines.machine("two") === other)
        XCTAssertNil(old.activeChat)
        await old.unpair()
        XCTAssertEqual(try store.session(environmentId: "one")?.sessionId, "replacement")
        XCTAssertTrue(machines.machine("one") === replacement)
    }

    func testRevokingOneComputerRemovesOnlyItsSessionAndRuntime() async throws {
        let store = LocalStore(inMemory: true)
        try seed(store, machine: "one", text: "First")
        try seed(store, machine: "two", text: "Second")
        let machines = MachineStore(store: store)
        machines.scenePhaseChanged(.background)
        defer { machines.machines.forEach { $0.stop() } }
        let revoked = try XCTUnwrap(machines.machine("one"))
        let other = try XCTUnwrap(machines.machine("two"))
        revoked.gateway.onFailure?(.hostError(code: "device_revoked", message: "Revoked", retryable: false))
        let deadline = ContinuousClock.now.advanced(by: .seconds(1))
        while machines.machine("one") != nil, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(1))
        }
        XCTAssertNil(machines.machine("one"))
        XCTAssertNil(try store.session(environmentId: "one"))
        XCTAssertTrue(machines.machine("two") === other)
        XCTAssertNotNil(try store.session(environmentId: "two"))
    }

    func testTranscriptCacheKeepsSameThreadIdSeparateAcrossMachines() throws {
        let store = LocalStore(inMemory: true)
        try store.saveTranscript(threadId: "shared", environmentId: "one", rawJSON: transcriptData("First"))
        try store.saveTranscript(threadId: "shared", environmentId: "two", rawJSON: transcriptData("Second"))
        try store.saveTranscript(threadId: "shared", environmentId: "one", rawJSON: transcriptData("Updated"))
        XCTAssertEqual(try store.decodedTranscript(threadId: "shared", environmentId: "one")?.events.first?.text, "Updated")
        XCTAssertEqual(try store.decodedTranscript(threadId: "shared", environmentId: "two")?.events.first?.text, "Second")
        XCTAssertNil(try store.decodedTranscript(threadId: "shared", environmentId: "missing"))
    }

    func testLegacyTranscriptMigratesOnSaveWithoutLeakingIntoAnotherMachine() throws {
        let store = LocalStore(inMemory: true)
        store.container.mainContext.insert(CachedThreadTranscript(
            threadId: "shared", environmentId: "one", rawJSON: try transcriptData("Legacy")))
        try store.container.mainContext.save()
        XCTAssertEqual(try store.decodedTranscript(threadId: "shared", environmentId: "one")?.events.first?.text, "Legacy")
        XCTAssertNil(try store.decodedTranscript(threadId: "shared", environmentId: "two"))
        try store.saveTranscript(threadId: "shared", environmentId: "one", rawJSON: transcriptData("Fresh"))
        let cached = try store.container.mainContext.fetch(FetchDescriptor<CachedThreadTranscript>())
        XCTAssertEqual(cached.count, 1)
        XCTAssertEqual(cached.first?.threadId, MachineResourceID.encode("one", "shared"))
        XCTAssertEqual(try store.decodedTranscript(threadId: "shared", environmentId: "one")?.events.first?.text, "Fresh")
    }

    func testNamespacedTranscriptWinsOverAnOlderLegacyRow() throws {
        let store = LocalStore(inMemory: true)
        for (key, text) in [("shared", "Old"), (MachineResourceID.encode("one", "shared"), "New")] {
            store.container.mainContext.insert(CachedThreadTranscript(
                threadId: key, environmentId: "one", rawJSON: try transcriptData(text)))
        }
        try store.container.mainContext.save()
        XCTAssertEqual(try store.decodedTranscript(threadId: "shared", environmentId: "one")?.events.first?.text, "New")
    }

    func testResourceIdentityRoundTripsDelimiterAndUnicodeCharacters() throws {
        let id = MachineResourceID.encode("host:[\"one\"]🖥", "thread:two/三")
        let decoded = try XCTUnwrap(MachineResourceID.decode(id))
        XCTAssertEqual(decoded.environmentId, "host:[\"one\"]🖥")
        XCTAssertEqual(decoded.resourceId, "thread:two/三")
        XCTAssertNotEqual(MachineResourceID.encode("a:b", "c"), MachineResourceID.encode("a", "b:c"))
    }

    private func session(_ id: String, sessionId: String = "original") -> PersistedSession {
        PersistedSession(environmentId: id, environmentLabel: id,
            httpBaseUrl: "https://example.invalid", wsBaseUrl: "wss://example.invalid",
            sessionId: sessionId, deviceId: "test-device", keychainAccount: "test.MultiMachineTests.\(UUID())",
            protocolVersion: 1, capabilities: [])
    }

    private func seed(_ store: LocalStore, machine: String, text: String, running: Bool = false) throws {
        try store.upsertSession(session(machine))
        let snapshot = EnvironmentSnapshot(
            environment: EnvironmentInfo(id: machine, label: machine, hostVersion: "1", protocolVersion: 1, capabilities: [], cursor: 1),
            projects: [ProjectInfo(id: "project", name: "Project", kind: "repo", path: "/project")],
            threads: [ThreadInfo(id: "shared", projectId: "project", title: "Shared thread", updatedAt: 1, status: running ? "running" : "idle")],
            activeRuns: running ? [ActiveRun(id: "run", threadId: "shared", projectId: "project", status: "running", startedAt: 1)] : [],
            pendingApprovals: [], pendingQuestions: [], selectedTranscript: nil, cursor: 1)
        try store.saveSnapshot(environmentId: machine, rawJSON: JSONEncoder().encode(snapshot))
        try store.saveTranscript(threadId: "shared", environmentId: machine, rawJSON: transcriptData(text))
    }

    private func transcriptData(_ text: String) throws -> Data {
        let event = TimelineEvent(id: "message", cursor: 1, kind: "assistant.message", threadId: "shared", runId: nil,
            createdAt: 1, text: text, toolName: nil, approvalId: nil, questionId: nil, diffId: nil, runStatus: nil)
        return try JSONEncoder().encode(TranscriptContainer(threadId: "shared", cursor: 1, events: [event]))
    }
}

final class ConnectionPresentationTests: XCTestCase {
    func testNetworkReachabilityIsQuietButTLSAndAuthenticationFailuresAreWarnings() {
        let offlineCodes: [URLError.Code] = [.cannotFindHost, .cannotConnectToHost, .timedOut, .networkConnectionLost, .notConnectedToInternet]
        for code in offlineCodes {
            XCTAssertTrue(GraftError.transport(URLError(code)).isOffline)
        }
        let securityCodes: [URLError.Code] = [.secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate, .clientCertificateRejected]
        for code in securityCodes {
            XCTAssertFalse(GraftError.transport(URLError(code)).isOffline)
            XCTAssertFalse(GraftError.transport(URLError(code)).isRetryable)
        }
        XCTAssertTrue(GraftError.transport(POSIXError(.ECONNREFUSED)).isOffline)
        XCTAssertTrue(GraftError.transport(POSIXError(.ENOTCONN)).isOffline)
        XCTAssertFalse(GraftError.transport(POSIXError(.EACCES)).isOffline)
        XCTAssertFalse(GraftError.unauthorized.isOffline)
        XCTAssertFalse(GraftError.decoding("Invalid response").isOffline)
    }

    func testHTTPRelayHostOfflineIsQuietWithoutHidingOtherServiceFailures() {
        let offline = Data(#"{"ok":false,"error":{"code":"host_offline","message":"Computer offline","retryable":true}}"#.utf8)
        XCTAssertTrue(GraftError.httpResponse(status: 503, body: offline).isOffline)
        XCTAssertFalse(GraftError.httpResponse(status: 401, body: offline).isOffline)
        XCTAssertFalse(GraftError.httpResponse(status: 503, body: Data("Service unavailable".utf8)).isOffline)
        let invalid = Data(#"{"ok":false,"error":{"code":"protocol_mismatch","message":"Update required","retryable":false}}"#.utf8)
        XCTAssertFalse(GraftError.httpResponse(status: 400, body: invalid).isOffline)
    }
}

@MainActor
struct MachineNameTests {
    @Test(arguments: ["omarchy", "MacBook Pro", "  "])
    func cachedMachineNameReplacesPairingLabelWithoutChangingSession(name: String) throws {
        let store = LocalStore(inMemory: true)
        let session = PersistedSession(
            environmentId: "machine", environmentLabel: "brentwarner",
            httpBaseUrl: "https://example.invalid", wsBaseUrl: "wss://example.invalid",
            sessionId: "paired-session", deviceId: "test-device", keychainAccount: "test.MachineNameTests",
            protocolVersion: 1, capabilities: [])
        try store.upsertSession(session)
        let snapshot = EnvironmentSnapshot(
            environment: EnvironmentInfo(id: "machine", label: name, hostVersion: "1", protocolVersion: 1, capabilities: [], cursor: 1),
            projects: [], threads: [], activeRuns: [], pendingApprovals: [], pendingQuestions: [],
            selectedTranscript: nil, cursor: 1)
        try store.saveSnapshot(environmentId: "machine", rawJSON: JSONEncoder().encode(snapshot))
        let app = AppModel(store: store, gateway: GatewayClient(monitorNetwork: false), environmentId: "machine")
        defer { app.stop() }
        #expect(app.environmentLabel == (name == "  " ? "brentwarner" : name))
        #expect(app.connection.session?.sessionId == "paired-session")
        #expect(app.connection.session?.environmentLabel == "brentwarner")
    }
}
