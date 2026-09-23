import SwiftUI
import UIKit
import XCTest

@testable import Graft

/// Hosted native UI checks; metadata and command outcomes are isolated fixtures.
@MainActor
final class ThreadDetailsVisualTests: XCTestCase {
    func testCompactDetailsRemainReadableInBothAppearancesAndLargeType() async throws {
        for (name, scheme, size) in [
            ("light", ColorScheme.light, DynamicTypeSize.large),
            ("dark", .dark, .large),
            ("large-type", .light, .accessibility1),
        ] {
            var renamed = false
            let window = host(DetailsPopoverFixture {
                self.details(onRename: { renamed = true }).environment(\.dynamicTypeSize, size)
            }, scheme: scheme)
            defer { close(window) }
            await settle(window)
            XCTAssertTrue(activate(try node("Show thread menu", in: window)))
            await settle(window)
            capture(window, name)
            let branch = try node("codex/thread-details", in: window)
            let workspace = try node("thread-details", in: window)
            let rename = try node("Rename thread", in: window)
            _ = try node("Worktree", in: window)
            XCTAssertGreaterThanOrEqual(rename.accessibilityFrame.height, 44)
            XCTAssertLessThan(branch.accessibilityFrame.maxY, workspace.accessibilityFrame.minY)
            XCTAssertLessThan(workspace.accessibilityFrame.maxY, rename.accessibilityFrame.minY)
            XCTAssertLessThan(rename.accessibilityFrame.maxY - branch.accessibilityFrame.minY,
                              size == .large ? 200 : 350)
            for control in [branch, workspace, rename] {
                XCTAssertGreaterThanOrEqual(control.accessibilityFrame.minX, 0)
                XCTAssertLessThanOrEqual(control.accessibilityFrame.maxX, window.bounds.width)
            }
            XCTAssertFalse(objects(in: window).contains { $0.accessibilityLabel == "Provider" })
            XCTAssertTrue(activate(rename))
            XCTAssertTrue(renamed)
        }
    }

    func testUnavailableDetailsOfferRetryOnlyWhileConnected() async throws {
        for connected in [true, false] {
            var retried = false
            let window = host(DetailsPopoverFixture {
                ThreadDetailsContent(
                    thread: nil, title: "Thread details", projectName: "Graft",
                    details: nil, loading: false, failed: true, connected: connected,
                    onRetry: { retried = true }, onRename: {}
                )
            }, scheme: .light)
            defer { close(window) }
            await settle(window)
            XCTAssertTrue(activate(try node("Show thread menu", in: window)))
            await settle(window)
            capture(window, connected ? "unavailable" : "offline")
            _ = try node("Branch unavailable", in: window)
            XCTAssertEqual(try node("Rename thread", in: window).accessibilityTraits.contains(.notEnabled), !connected)
            if connected {
                let retry = try node("Retry", in: window)
                XCTAssertGreaterThanOrEqual(retry.accessibilityFrame.height, 44)
                XCTAssertTrue(activate(retry))
                XCTAssertTrue(retried)
            } else {
                XCTAssertFalse(objects(in: window).contains { $0.accessibilityLabel == "Retry" })
            }
        }
    }

    func testRenamePreservesDraftAfterFailureAndRetriesTrimmedTitle() async throws {
        var saves: [String] = []
        let window = host(DetailsPopoverFixture {
            ThreadRenameForm(title: "  Improve thread details  ") { title in
                saves.append(title)
                if saves.count == 1 { throw RenameFailure() }
            } onCancel: {}
        }, scheme: .light)
        defer { close(window) }
        await settle(window)
        XCTAssertTrue(activate(try node("Show thread menu", in: window)))
        await settle(window)
        capture(window, "rename-before")
        for label in ["Save", "Cancel"] {
            let control = try node(label, in: window)
            XCTAssertGreaterThanOrEqual(control.accessibilityFrame.height, 44)
            XCTAssertGreaterThanOrEqual(control.accessibilityFrame.width, 60)
        }
        XCTAssertTrue(activate(try node("Save", in: window)))
        await settle(window)
        XCTAssertEqual(saves, ["Improve thread details"])
        _ = try node("The computer disconnected. Try again.", in: window)
        let input = try XCTUnwrap(objects(in: window).compactMap { $0 as? UITextView }.first)
        XCTAssertEqual(input.text, "  Improve thread details  ")
        capture(window, "rename-failed")
        XCTAssertTrue(activate(try node("Save", in: window)))
        await settle(window)
        XCTAssertEqual(saves, ["Improve thread details", "Improve thread details"])
        XCTAssertFalse(objects(in: window).contains { $0.accessibilityLabel == "The computer disconnected. Try again." })
        capture(window, "rename-retried")
    }

    func testRenameRejectsEmptyAndOverlongTitlesAndCancels() async throws {
        for title in ["   ", String(repeating: "A", count: 201)] {
            var cancelled = false
            let window = host(ThreadRenameForm(title: title) { _ in
                XCTFail("An invalid title must never be submitted.")
            } onCancel: { cancelled = true }, scheme: .light)
            defer { close(window) }
            await settle(window)
            XCTAssertTrue(try node("Save", in: window).accessibilityTraits.contains(.notEnabled))
            if title.count > 200 { _ = try node("Use 200 characters or fewer.", in: window) }
            capture(window, title.count > 200 ? "rename-overlong" : "rename-empty")
            XCTAssertTrue(activate(try node("Cancel", in: window)))
            XCTAssertTrue(cancelled)
        }
    }

    func testActualThreadToolbarGroupsUsageAndOptionsAndOpensBothPopovers() async throws {
        let app = try makeApp()
        defer { app.stop() }
        let window = host(NavigationStack {
            ThreadView(threadId: Self.thread.id, title: "Fallback title").environment(app)
        }, scheme: .light)
        defer { close(window) }
        await settle(window)
        capture(window, "toolbar")
        let usage = try node("Context: 42% used", in: window)
        let options = try node("Thread options", in: window)
        XCTAssertEqual(usage.accessibilityFrame.height, options.accessibilityFrame.height, accuracy: 1)
        XCTAssertEqual(usage.accessibilityFrame.midY, options.accessibilityFrame.midY, accuracy: 1)
        XCTAssertLessThanOrEqual(usage.accessibilityFrame.maxX, options.accessibilityFrame.minX + 1)
        XCTAssertTrue(activate(options))
        await settle(window)
        _ = try node("Rename thread", in: window)
        _ = try node("Branch unavailable", in: window)
        capture(window, "actual-popover")
        window.rootViewController?.dismiss(animated: false)
        await settle(window)
        XCTAssertTrue(activate(try node("Context: 42% used", in: window)))
        await settle(window)
        _ = try node("Context window", in: window)
        capture(window, "usage-popover")
    }

    private struct RenameFailure: LocalizedError {
        var errorDescription: String? { "The computer disconnected. Try again." }
    }

    private static var thread: ThreadInfo {
        var thread = ThreadInfo(
            id: "thread-menu-fixture", projectId: "project-menu-fixture", title: "Improve thread details",
            updatedAt: 1_790_164_800_000, status: "idle", modelName: "6 Astra", providerId: "codex",
            mode: "worktree", approvalPolicy: "ask-first",
            pr: ThreadPrInfo(number: 127, state: .open, url: "https://example.com/repo/pull/127"),
            contextUsage: ContextUsageInfo(percent: 42, tokensUsed: 42_000, tokensMax: 100_000, source: "measured")
        )
        thread.effort = "high"
        thread.fastMode = true
        return thread
    }

    private func details(onRename: @escaping () -> Void) -> ThreadDetailsContent {
        ThreadDetailsContent(
            thread: Self.thread, title: Self.thread.title, projectName: "Graft",
            details: ThreadDetailsInfo(thread: Self.thread, workspaceName: "thread-details",
                                       gitStatus: "available", branch: "codex/thread-details"),
            loading: false, failed: false, connected: true, onRetry: {}, onRename: onRename
        )
    }

    private func makeApp() throws -> AppModel {
        let store = LocalStore(inMemory: true)
        try store.upsertSession(PersistedSession(
            environmentId: "thread-menu-fixture", environmentLabel: "Studio Mac",
            httpBaseUrl: "http://127.0.0.1:1", wsBaseUrl: "ws://127.0.0.1:1",
            sessionId: "thread-menu-fixture", deviceId: "thread-menu-fixture", keychainAccount: "thread-menu-fixture-no-token",
            protocolVersion: 1, capabilities: []
        ))
        let snapshot = EnvironmentSnapshot(
            environment: EnvironmentInfo(id: "thread-menu-fixture", label: "Studio Mac", hostVersion: nil,
                                         protocolVersion: 1, capabilities: [], cursor: 1),
            projects: [ProjectInfo(id: Self.thread.projectId, name: "Graft", kind: "local")], threads: [Self.thread],
            activeRuns: [], pendingApprovals: [], pendingQuestions: [], selectedTranscript: nil, cursor: 1
        )
        try store.saveSnapshot(environmentId: "thread-menu-fixture", rawJSON: JSONEncoder().encode(snapshot))
        return AppModel(store: store)
    }

    private func host<Content: View>(_ content: Content, scheme: ColorScheme) -> UIWindow {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first!
        let window = UIWindow(windowScene: scene)
        window.frame = scene.screen.bounds
        window.overrideUserInterfaceStyle = scheme == .dark ? .dark : .light
        let controller = UIHostingController(rootView: content.environment(\.colorScheme, scheme))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        UIAccessibility.post(notification: .screenChanged, argument: controller.view)
        controller.view.frame = window.bounds
        controller.view.layoutIfNeeded()
        return window
    }

    private func close(_ window: UIWindow) {
        window.endEditing(true)
        window.rootViewController?.dismiss(animated: false)
        window.isHidden = true
        window.rootViewController = nil
    }

    private func settle(_ window: UIWindow) async {
        try? await Task.sleep(for: .milliseconds(400))
        window.layoutIfNeeded()
    }

    private func node(_ label: String, in window: UIWindow) throws -> NSObject {
        try XCTUnwrap(objects(in: window).first { $0.accessibilityLabel == label }, "Missing native control: \(label)")
    }

    private func activate(_ object: NSObject) -> Bool {
        if let control = object as? UIControl { control.sendActions(for: .touchUpInside); return true }
        if object.accessibilityActivate() { return true }
        return (object.accessibilityCustomActions ?? []).contains { $0.actionHandler?($0) == true }
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

    private func capture(_ window: UIWindow, _ name: String) {
        let image = UIGraphicsImageRenderer(size: window.bounds.size).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let screenshot = XCTAttachment(image: image)
        screenshot.name = "thread-menu-\(name)"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let hierarchy = objects(in: window).map {
            "\(type(of: $0)) label=\($0.accessibilityLabel ?? "") value=\($0.accessibilityValue ?? "") frame=\($0.accessibilityFrame) traits=\($0.accessibilityTraits.rawValue)"
        }.joined(separator: "\n")
        let tree = XCTAttachment(string: hierarchy)
        tree.name = "thread-menu-\(name)-hierarchy"
        tree.lifetime = .keepAlways
        add(tree)
    }
}

private struct DetailsPopoverFixture<Content: View>: View {
    @State private var presented = false
    @ViewBuilder let content: () -> Content

    var body: some View {
        NavigationStack {
            Color.clear
                .navigationTitle("Thread")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Show thread menu", systemImage: "ellipsis") { presented = true }
                            .popover(isPresented: $presented) {
                                content().presentationCompactAdaptation(.popover)
                            }
                    }
                }
        }
    }
}
