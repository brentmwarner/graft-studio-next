import SwiftUI
import Vision
import XCTest
@testable import Graft

@MainActor
final class LiveDiffRefreshTests: XCTestCase {
    func testVisibleThreadRefreshesWorkingChangesDuringActiveRunWithoutDiffEvents() async throws {
        let fixture = try await makeFixture()
        defer { fixture.app.stop() }
        let window = host(ThreadView(threadId: fixture.chat.threadId, title: "Live edit verification")
            .environment(fixture.app)
            .environment(\.scenePhase, .active))
        defer { close(window) }
        try await waitUntil { fixture.wire.diffRequests.count >= 2 }
        XCTAssertTrue(fixture.chat.isTurnActive)
        XCTAssertTrue(fixture.chat.pendingDiffs.isEmpty)
        capture(window, "empty-active")

        fixture.wire.summary = Self.summary(files: [Self.file("src/Editor.swift", additions: 3, deletions: 1)])
        try await waitUntil { fixture.chat.pendingDiffs.first?.additions == 3 }
        XCTAssertTrue(fixture.chat.isTurnActive, "The pill must appear before the turn ends.")
        try await assertRenderedCounts(additions: 3, deletions: 1, in: window)
        capture(window, "first-edit-active")

        fixture.wire.summary = Self.summary(files: [
            Self.file("src/Editor.swift", additions: 8, deletions: 2),
            Self.file("src/Toolbar.swift", additions: 4, deletions: 1),
        ])
        try await waitUntil { fixture.chat.pendingDiffs.first?.additions == 12 }
        XCTAssertTrue(fixture.chat.isTurnActive)
        XCTAssertEqual(fixture.chat.pendingDiffs.first?.fileCount, 2)
        XCTAssertEqual(fixture.chat.pendingDiffs.first?.deletions, 3)
        try await assertRenderedCounts(additions: 12, deletions: 3, in: window)
        capture(window, "updated-counts-active")

        fixture.wire.summary = Self.summary(files: [])
        let requestCount = fixture.wire.diffRequests.count
        fixture.chat.fold(Self.runEvent(status: "completed"))
        try await waitUntil { !fixture.chat.isTurnActive && fixture.chat.pendingDiffs.isEmpty }
        XCTAssertGreaterThan(fixture.wire.diffRequests.count, requestCount, "Idle must perform a final refresh.")
        try await waitUntil {
            guard let text = try? self.renderedAccessoryText(in: window) else { return false }
            return !text.contains("+12")
        }
        capture(window, "idle-cleared")
        let idleCount = fixture.wire.diffRequests.count
        try await Task.sleep(for: .milliseconds(2300))
        XCTAssertEqual(fixture.wire.diffRequests.count, idleCount, "Idle must not keep polling.")
    }

    func testCancelledPollingIgnoresDelayedDiffResponseAndStopsRequests() async throws {
        let fixture = try await makeFixture()
        defer { fixture.app.stop() }
        fixture.wire.automaticallyResponds = false
        let count = fixture.wire.diffRequests.count
        let polling = Task { await fixture.chat.pollWorkingDiff() }
        defer { polling.cancel() }
        try await waitUntil { fixture.wire.diffRequests.count > count }
        let delayed = try XCTUnwrap(fixture.wire.diffRequests.last)
        polling.cancel()
        await polling.value
        try fixture.wire.respond(to: delayed, with: Self.summary(files: [Self.file("stale.swift", additions: 99)]))
        try await Task.sleep(for: .milliseconds(2300))
        XCTAssertTrue(fixture.chat.pendingDiffs.isEmpty, "A cancelled view task cannot resurrect the old pill.")
        XCTAssertEqual(fixture.wire.diffRequests.count, count + 1)
    }

    func testSupersededRefreshCannotRestoreDiffAfterNewerEmptyResponse() async throws {
        let fixture = try await makeFixture()
        defer { fixture.app.stop() }
        fixture.wire.automaticallyResponds = false
        let count = fixture.wire.diffRequests.count
        let older = Task { await fixture.chat.refreshDiff() }
        try await waitUntil { fixture.wire.diffRequests.count == count + 1 }
        let oldRequest = fixture.wire.diffRequests[count]
        let newer = Task { await fixture.chat.refreshDiff() }
        try await waitUntil { fixture.wire.diffRequests.count == count + 2 }
        try fixture.wire.respond(to: fixture.wire.diffRequests[count + 1], with: Self.summary(files: []))
        await newer.value
        try fixture.wire.respond(to: oldRequest, with: Self.summary(files: [Self.file("stale.swift", additions: 99)]))
        await older.value
        XCTAssertTrue(fixture.chat.pendingDiffs.isEmpty, "The older reply must not overwrite the newer empty state.")
    }

    func testPendingOpenUsesNewerPollingReplyInsteadOfLateTapResponse() async throws {
        for files in [[], [Self.file("current.swift", additions: 7)]] {
            let fixture = try await makeFixture()
            defer { fixture.app.stop() }
            fixture.wire.automaticallyResponds = false
            let count = fixture.wire.diffRequests.count
            let opening = Task { await fixture.chat.openDiff(id: fixture.chat.threadId) }
            try await waitUntil { fixture.wire.diffRequests.count == count + 1 }
            let tapRequest = fixture.wire.diffRequests[count]
            let polling = Task { await fixture.chat.refreshDiff() }
            try await waitUntil { fixture.wire.diffRequests.count == count + 2 }
            let latest = Self.summary(files: files)
            try fixture.wire.respond(to: fixture.wire.diffRequests[count + 1], with: latest)
            await polling.value
            try fixture.wire.respond(to: tapRequest, with: Self.summary(files: [Self.file("stale.swift", additions: 99)]))
            await opening.value
            XCTAssertEqual(fixture.chat.openedDiff, files.isEmpty ? nil : latest)
            XCTAssertEqual(fixture.chat.pendingDiffs.first?.additions, files.isEmpty ? nil : 7)
        }
    }

    private func makeFixture() async throws -> Fixture {
        let wire = LiveDiffSocket()
        let gateway = GatewayClient(monitorNetwork: false,
            timing: GatewayConnectionTiming(heartbeat: .seconds(600)), makeSocket: { _ in wire })
        let store = LocalStore(inMemory: true)
        try store.upsertSession(PersistedSession(
            environmentId: "live-diff-fixture", environmentLabel: "Synthetic verification",
            httpBaseUrl: "http://127.0.0.1:1", wsBaseUrl: "ws://127.0.0.1:1",
            sessionId: "live-diff-fixture", deviceId: "live-diff-fixture",
            keychainAccount: "live-diff-fixture-no-token", protocolVersion: 1, capabilities: []
        ))
        let snapshot = EnvironmentSnapshot(
            environment: EnvironmentInfo(id: "live-diff-fixture", label: "Synthetic verification",
                hostVersion: nil, protocolVersion: 1, capabilities: [], cursor: 1),
            projects: [],
            threads: [ThreadInfo(id: "live-diff-thread", projectId: "synthetic-project",
                title: "Live edit verification", updatedAt: 0, status: "running", preview: nil,
                modelName: "gpt-6", providerId: "codex", mode: "local")],
            activeRuns: [ActiveRun(id: "live-diff-run", threadId: "live-diff-thread", status: "running", startedAt: 0)],
            pendingApprovals: [], pendingQuestions: [],
            selectedTranscript: TranscriptContainer(threadId: "live-diff-thread", cursor: 1, events: [
                TimelineEvent(id: "synthetic-request", cursor: 1, kind: "user.message",
                    threadId: "live-diff-thread", runId: "live-diff-run", createdAt: 0,
                    text: "Update the editor and toolbar. Keep the changes visible while working.",
                    toolName: nil, approvalId: nil, questionId: nil, diffId: nil, runStatus: nil),
            ]), cursor: 1
        )
        try store.saveSnapshot(environmentId: "live-diff-fixture", rawJSON: JSONEncoder().encode(snapshot))
        let app = AppModel(store: store, gateway: gateway)
        gateway.requestProvider = { URLRequest(url: URL(string: "ws://127.0.0.1:1")!) }
        gateway.helloProvider = { ClientHello(sessionId: "live-diff-fixture", afterCursor: nil) }
        try await gateway.ensureConnected()
        await app.openThread("live-diff-thread", title: "Live edit verification")
        let chat = try XCTUnwrap(app.activeChat)
        await chat.refreshDiff()
        XCTAssertTrue(chat.isTurnActive)
        return Fixture(app: app, chat: chat, wire: wire)
    }

    fileprivate static func summary(files: [DiffFile]) -> DiffSummary {
        DiffSummary(id: "live-diff-thread", threadId: "live-diff-thread", runId: nil,
            title: "Working changes", files: files, updatedAt: 1, source: "working-tree")
    }

    private static func file(_ path: String, additions: Int, deletions: Int = 0) -> DiffFile {
        DiffFile(path: path, status: "modified", additions: additions, deletions: deletions,
            previousPath: nil, hunks: nil, detailStatus: nil)
    }

    private static func runEvent(status: String) -> TimelineEvent {
        TimelineEvent(id: "synthetic-completion", cursor: 2, kind: "run.status", threadId: "live-diff-thread",
            runId: "live-diff-run", createdAt: 1, text: nil, toolName: nil,
            approvalId: nil, questionId: nil, diffId: nil, runStatus: status)
    }

    private func waitUntil(_ predicate: @MainActor () -> Bool,
                           file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while !predicate(), ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        guard predicate() else {
            XCTFail("Timed out waiting for live diff state", file: file, line: line)
            throw LiveDiffTestError.timedOut
        }
    }

    private func host<Content: View>(_ content: Content) -> UIWindow {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first!
        let window = UIWindow(windowScene: scene)
        window.frame = scene.screen.bounds
        window.overrideUserInterfaceStyle = .light
        let controller = UIHostingController(rootView: NavigationStack { content }.environment(\.colorScheme, .light))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        UIAccessibility.post(notification: .screenChanged, argument: controller.view)
        controller.view.frame = window.bounds
        controller.view.layoutIfNeeded()
        return window
    }

    private func close(_ window: UIWindow) {
        window.isHidden = true
        window.rootViewController = nil
    }

    private func objects(in root: NSObject) -> [NSObject] {
        var visited: Set<ObjectIdentifier> = []
        var result: [NSObject] = []
        func visit(_ object: NSObject) {
            guard visited.insert(ObjectIdentifier(object)).inserted else { return }
            result.append(object)
            var children = object.accessibilityElements ?? []
            children.append(contentsOf: object.automationElements ?? [])
            let count = object.accessibilityElementCount()
            if count > 0, count < 200 {
                for index in 0..<count {
                    if let child = object.accessibilityElement(at: index) { children.append(child) }
                }
            }
            children.compactMap { $0 as? NSObject }.forEach(visit)
            if let view = object as? UIView { view.subviews.forEach(visit) }
        }
        visit(root)
        return result
    }

    private func renderedAccessoryText(in window: UIWindow) throws -> String {
        window.layoutIfNeeded()
        // Hosted SwiftUI windows may render correctly without publishing AX nodes.
        // Inspect the rendered accessory area, as the transcript tests do on iPad.
        let bounds = CGRect(x: 0, y: window.bounds.height - 240, width: window.bounds.width, height: 240)
        let image = UIGraphicsImageRenderer(size: bounds.size).image { context in
            context.cgContext.translateBy(x: 0, y: -bounds.minY)
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        request.usesLanguageCorrection = false
        try VNImageRequestHandler(cgImage: XCTUnwrap(image.cgImage)).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: " ").replacingOccurrences(of: "−", with: "-")
            .replacingOccurrences(of: " ", with: "")
    }

    private func assertRenderedCounts(additions: Int, deletions: Int, in window: UIWindow) async throws {
        try await waitUntil {
            guard let text = try? self.renderedAccessoryText(in: window) else { return false }
            return text.contains("+\(additions)") && text.contains("-\(deletions)")
        }
    }

    private func capture(_ window: UIWindow, _ name: String) {
        window.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(size: window.bounds.size).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = "live-diff-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
        let hierarchy = objects(in: window).map {
            "\(type(of: $0)) label=\($0.accessibilityLabel ?? "") frame=\($0.accessibilityFrame)"
        }.joined(separator: "\n")
        let tree = XCTAttachment(string: hierarchy)
        tree.name = "live-diff-\(name)-hierarchy"
        tree.lifetime = .keepAlways
        add(tree)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("live-diff-evidence")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? image.pngData()?.write(to: directory.appendingPathComponent("\(name).png"))
        try? hierarchy.write(to: directory.appendingPathComponent("\(name).txt"), atomically: true, encoding: .utf8)
    }

    private struct Fixture {
        let app: AppModel
        let chat: ChatModel
        let wire: LiveDiffSocket
    }

    private enum LiveDiffTestError: Error { case timedOut }
}

/// Uses the real GatewayClient/AppModel command path while controlling reply order.
/// It never emits diff.updated and never opens a network connection.
@MainActor
private final class LiveDiffSocket: GatewaySocketTransport {
    var summary = LiveDiffRefreshTests.summary(files: [])
    var automaticallyResponds = true
    private(set) var diffRequests: [ClientCommandEnvelope] = []
    private var frames: [URLSessionWebSocketTask.Message] = []
    private var waiter: CheckedContinuation<URLSessionWebSocketTask.Message, Error>?
    private var cancelled = false

    func resume() {}

    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        cancelled = true
        let pending = waiter
        waiter = nil
        pending?.resume(throwing: GraftError.socketClosed)
    }

    func send(_ message: URLSessionWebSocketTask.Message) async throws {
        let data: Data
        switch message {
        case .string(let text): data = Data(text.utf8)
        case .data(let bytes): data = bytes
        @unknown default: throw GraftError.decoding("Unknown fixture frame")
        }
        if let hello = try? JSONDecoder().decode(ClientHello.self, from: data), hello.envelope == "hello" {
            try push(HostWelcome(envelope: "welcome", protocolVersion: 1, capabilities: [],
                environmentId: "live-diff-fixture", environmentLabel: "Synthetic verification", cursor: 1))
            return
        }
        guard let command = try? JSONDecoder().decode(ClientCommandEnvelope.self, from: data) else { return }
        if case .diffGet = command.command {
            diffRequests.append(command)
            if automaticallyResponds { try respond(to: command, with: summary) }
        } else {
            try push(HostResponseEnvelope(envelope: "response", commandId: command.commandId,
                requestId: command.requestId, receipt: CommandReceipt(commandId: command.commandId,
                    status: "completed", runId: nil, cursor: nil), result: nil))
        }
    }

    func receive() async throws -> URLSessionWebSocketTask.Message {
        if !frames.isEmpty { return frames.removeFirst() }
        if cancelled { throw GraftError.socketClosed }
        return try await withCheckedThrowingContinuation { waiter = $0 }
    }

    func respond(to command: ClientCommandEnvelope, with summary: DiffSummary) throws {
        try push(HostResponseEnvelope(envelope: "response", commandId: command.commandId,
            requestId: command.requestId, receipt: CommandReceipt(commandId: command.commandId,
                status: "completed", runId: nil, cursor: nil),
            result: CommandResult(type: "diff.get.result", run: nil, diff: summary, thread: nil, models: nil)))
    }

    private func push(_ value: some Encodable) throws {
        let frame = URLSessionWebSocketTask.Message.data(try JSONEncoder().encode(value))
        if let pending = waiter {
            waiter = nil
            pending.resume(returning: frame)
        } else {
            frames.append(frame)
        }
    }
}
