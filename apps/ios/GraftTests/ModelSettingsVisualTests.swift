import SwiftUI
import UIKit
import XCTest
import Network

@testable import Graft

/// Hosted native controls with an isolated, in-memory catalog. These verify
/// UIKit/SwiftUI interactions, not a live Studio provider round trip.
@MainActor
final class ModelSettingsVisualTests: XCTestCase {

    func testNewChatProviderMenuKeepsKeyboardLayoutInBothAppearances() async throws {
        for scheme in [ColorScheme.light, .dark] {
            let app = AppModel(store: LocalStore(inMemory: true))
            await app.models.load { Self.newChatCatalog }
            let window = host(NavigationStack { NewChatView().environment(app) }, scheme: scheme)
            defer { close(window) }
            await settle(window)
            let input = try XCTUnwrap(firstTextView(in: window))
            XCTAssertTrue(input.becomeFirstResponder())
            input.insertText("Keep this new-chat draft.")
            await settle(window)
            let beforeInput = input.convert(input.bounds, to: window)
            let trigger = try XCTUnwrap(element("new-chat-model-settings", in: window))
            XCTAssertGreaterThanOrEqual(trigger.accessibilityFrame.height, 44)
            XCTAssertEqual(trigger.accessibilityValue, "Codex Shared High")
            capture(window, "new-chat-before-\(scheme)")

            XCTAssertTrue(activate(trigger))
            await settle(window)
            let labels = Set(objects(in: window).compactMap(\.accessibilityLabel))
            XCTAssertTrue(labels.contains("Codex"))
            XCTAssertTrue(labels.contains("Claude"))
            XCTAssertTrue(labels.contains("Intelligence: High"))
            XCTAssertFalse(labels.contains("Codex Alternate"), "Models belong inside their provider submenu.")
            XCTAssertFalse(labels.contains("Speed"))
            XCTAssertFalse(labels.contains("Normal"))
            XCTAssertTrue(input.isFirstResponder)
            let afterInput = input.convert(input.bounds, to: window)
            XCTAssertEqual(afterInput.size, beforeInput.size)
            XCTAssertEqual(afterInput.minX, beforeInput.minX, accuracy: 0.5)
            // UIKit may hide its prediction row while a native menu is open.
            // The menu must overlay the page, not reserve its own height.
            XCTAssertLessThanOrEqual(abs(afterInput.minY - beforeInput.minY), 44)
            XCTAssertEqual(input.text, "Keep this new-chat draft.")
            capture(window, "new-chat-provider-root-\(scheme)")
        }
    }

    func testNewChatSlashPaletteReplacesModelAndApprovalChips() async throws {
        let app = AppModel(store: LocalStore(inMemory: true))
        await app.models.load { Self.newChatCatalog }
        let window = host(NavigationStack { NewChatView().environment(app) }, scheme: .light)
        defer { close(window) }
        await settle(window)

        let input = try XCTUnwrap(firstTextView(in: window))
        let model = try XCTUnwrap(node(labeled: "Provider, model, and intelligence", in: window))
        let permissions = try XCTUnwrap(node(labeled: "Permissions", in: window))
        let chipSpan = model.accessibilityFrame.width + permissions.accessibilityFrame.width
        XCTAssertTrue(input.becomeFirstResponder())
        input.insertText("/")
        await settle(window)

        XCTAssertNil(node(labeled: "Provider, model, and intelligence", in: window))
        XCTAssertNil(node(labeled: "Permissions", in: window))
        let palette = try XCTUnwrap(node(labeled: "Slash commands", in: window))
        let options = try XCTUnwrap(node(labeled: "Composer options", in: window))
        let send = try XCTUnwrap(node(labeled: "Send", in: window))
        XCTAssertEqual(palette.accessibilityFrame.minX, options.accessibilityFrame.minX, accuracy: 1)
        XCTAssertGreaterThanOrEqual(palette.accessibilityFrame.maxX, send.accessibilityFrame.maxX - 1)
        XCTAssertGreaterThan(palette.accessibilityFrame.width, chipSpan)
        XCTAssertLessThanOrEqual(palette.accessibilityFrame.maxY, input.accessibilityFrame.minY + 1)

        replace(input, with: "/review ")
        await settle(window)
        XCTAssertNil(node(labeled: "Slash commands", in: window))
        XCTAssertNotNil(node(labeled: "Provider, model, and intelligence", in: window))
        XCTAssertNotNil(node(labeled: "Permissions", in: window))

        replace(input, with: "/")
        await settle(window)
        XCTAssertNotNil(node(labeled: "Slash commands", in: window))
        XCTAssertNil(node(labeled: "Provider, model, and intelligence", in: window))

        replace(input, with: "")
        await settle(window)
        XCTAssertNil(node(labeled: "Slash commands", in: window))
        XCTAssertNotNil(node(labeled: "Provider, model, and intelligence", in: window))
        XCTAssertNotNil(node(labeled: "Permissions", in: window))
        XCTAssertEqual(input.text, "")
    }

    func testNewChatMenuShowsLoadingRetryAndRecoveredProviders() async throws {
        let catalog = ModelSettingsStore()
        let window = host(
            NewChatModelMenu(catalog: catalog, currentModel: nil, selectedEffort: .constant(nil),
                             onSelect: { _ in }, onRefresh: {})
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(DS.Color.bg),
            scheme: .light
        )
        defer { close(window) }
        await settle(window)
        XCTAssertTrue(activate(try XCTUnwrap(element("new-chat-model-settings", in: window))))
        await settle(window)
        XCTAssertTrue(objects(in: window).contains { $0.accessibilityLabel == "Load models" })
        capture(window, "new-chat-empty")
        XCTAssertTrue(escape(in: window))

        var response: CheckedContinuation<[ModelOption], Error>?
        let started = expectation(description: "New chat catalog is loading")
        let loading = Task {
            await catalog.load {
                try await withCheckedThrowingContinuation {
                    response = $0
                    started.fulfill()
                }
            }
        }
        await fulfillment(of: [started])
        await settle(window)
        XCTAssertTrue(activate(try XCTUnwrap(element("new-chat-model-settings", in: window))))
        await settle(window)
        XCTAssertTrue(objects(in: window).contains { $0.accessibilityLabel == "Loading models…" })
        capture(window, "new-chat-loading")
        XCTAssertTrue(escape(in: window))
        response?.resume(throwing: GraftError.notPaired)
        await loading.value
        await settle(window)
        XCTAssertTrue(activate(try XCTUnwrap(element("new-chat-model-settings", in: window))))
        await settle(window)
        XCTAssertTrue(objects(in: window).contains { $0.accessibilityLabel == "Retry" })
        capture(window, "new-chat-retry")
        XCTAssertTrue(escape(in: window))

        await catalog.load(force: true) { Self.newChatCatalog }
        await settle(window)
        XCTAssertTrue(activate(try XCTUnwrap(element("new-chat-model-settings", in: window))))
        await settle(window)
        let labels = visibleMenuLabels(in: window)
        XCTAssertTrue(labels.contains("Codex"))
        XCTAssertTrue(labels.contains("Claude"))
        XCTAssertFalse(labels.contains("Retry"))
        XCTAssertFalse(labels.contains { $0.hasPrefix("Intelligence:") }, "No model is selected in this fixture.")
        capture(window, "new-chat-recovered")
    }

    func testSixEffortReferenceCapsuleAndAccessibilityBounds() async throws {
        for direction in [LayoutDirection.leftToRight, .rightToLeft] {
            let app = AppModel(store: LocalStore(inMemory: true))
            await app.models.load { [Self.referenceModel] }
            let window = host(
                ModelQuickControls(threadId: "model-visual", onAdvanced: {})
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(DS.Color.bg)
                    .environment(app)
                    .environment(\.layoutDirection, direction),
                scheme: .light
            )
            defer { close(window) }
            await settle(window)
            let slider = try XCTUnwrap(element("model-effort-slider", in: window))
            let title = try XCTUnwrap(element("model-quick-advanced", in: window))
            XCTAssertEqual(slider.accessibilityFrame.width, 344, accuracy: 0.5)
            XCTAssertEqual(slider.accessibilityFrame.height, 72, accuracy: 0.5)
            XCTAssertLessThanOrEqual(title.accessibilityFrame.maxY, slider.accessibilityFrame.minY)
            XCTAssertEqual(slider.accessibilityLabel, "Intelligence")
            XCTAssertEqual(slider.accessibilityValue, "Max")
            capture(window, "six-effort-reference-\(direction)")

            slider.accessibilityIncrement()
            await settle(window)
            XCTAssertEqual(app.resolvedEffort(forThread: "model-visual"), "ultra")
            try XCTUnwrap(element("model-effort-slider", in: window)).accessibilityIncrement()
            await settle(window)
            XCTAssertEqual(app.resolvedEffort(forThread: "model-visual"), "ultra", "Increment must stop at the last supported effort.")
            for _ in 0..<6 {
                try XCTUnwrap(element("model-effort-slider", in: window)).accessibilityDecrement()
                await settle(window)
            }
            XCTAssertEqual(app.resolvedEffort(forThread: "model-visual"), "low", "Decrement must stop at the first supported effort.")
            capture(window, "six-effort-lower-bound-\(direction)")
        }
    }

    func testQuickControlOverActualTranscriptRemainsReadable() async throws {
        for scheme in [ColorScheme.light, .dark] {
            let app = AppModel(store: LocalStore(inMemory: true))
            await app.models.load { [Self.referenceModel] }
            let chat = ChatModel(threadId: "model-visual", title: "Busy transcript", app: app)
            let paragraphs = (1...12).map { index in
                "**Step \(index).** The model controls replace the composer while the existing chat stays in place. Choose an intelligence level for your next message, or open Advanced to change the model."
            }.joined(separator: "\n\n")
            chat.fold(TimelineEvent(
                id: "reference-user", cursor: 1, kind: "user.message", threadId: chat.threadId,
                runId: "reference-run", createdAt: 1, text: "Show the model controls over this conversation.",
                toolName: nil, approvalId: nil, questionId: nil, diffId: nil, runStatus: nil
            ))
            chat.fold(TimelineEvent(
                id: "reference-assistant", cursor: 2, kind: "assistant.message", threadId: chat.threadId,
                runId: "reference-run", createdAt: 2, text: paragraphs,
                toolName: nil, approvalId: nil, questionId: nil, diffId: nil, runStatus: nil,
                completedAt: 3
            ))
            chat.fold(TimelineEvent(
                id: "reference-completed", cursor: 3, kind: "run.status", threadId: chat.threadId,
                runId: "reference-run", createdAt: 3, text: nil,
                toolName: nil, approvalId: nil, questionId: nil, diffId: nil, runStatus: "completed"
            ))
            let window = host(
                TranscriptView(chat: chat)
                    .safeAreaInset(edge: .bottom) { ComposerView(chat: chat, siblingChromeHeight: 0) }
                    .background(DS.Color.bg)
                    .environment(app),
                scheme: scheme
            )
            defer { close(window) }
            await settle(window)
            let input = try XCTUnwrap(firstTextView(in: window))
            XCTAssertTrue(input.becomeFirstResponder())
            input.insertText("Preserve this draft and selection.")
            await settle(window)
            input.selectedRange = NSRange(location: 9, length: 4)
            let draft = input.text
            let selection = input.selectedRange
            let beforeInput = input.convert(input.bounds, to: window)
            let anchor = try XCTUnwrap(objects(in: window).compactMap { $0 as? ModelControlsAnchor }.first)
            let beforeComposer = anchor.convert(anchor.bounds, to: window)
            capture(window, "busy-transcript-keyboard-before-\(scheme)")

            XCTAssertTrue(activate(try XCTUnwrap(element("composer-model-settings", in: window))))
            await settle(window)
            let overlay = try XCTUnwrap(modelOverlay(in: window))
            let title = try XCTUnwrap(element("model-quick-advanced", in: window))
            let slider = try XCTUnwrap(element("model-effort-slider", in: window))
            XCTAssertFalse(overlay.isKeyWindow, "The source editor must retain the key window.")
            XCTAssertTrue(window.isKeyWindow)
            XCTAssertTrue(input.isFirstResponder)
            XCTAssertEqual(input.text, draft)
            XCTAssertEqual(input.selectedRange, selection)
            XCTAssertEqual(input.convert(input.bounds, to: window), beforeInput)
            XCTAssertLessThanOrEqual(title.accessibilityFrame.maxY, slider.accessibilityFrame.minY)
            XCTAssertTrue(window.bounds.contains(title.accessibilityFrame))
            XCTAssertEqual(slider.accessibilityFrame.maxY, beforeComposer.maxY - 8, accuracy: 1)
            capture(window, "busy-transcript-keyboard-quick-\(scheme)")

            XCTAssertTrue(escape(in: window))
            await settle(window)
            XCTAssertNil(modelOverlay(in: window))
            XCTAssertTrue(input.isFirstResponder)
            XCTAssertEqual(input.text, draft)
            XCTAssertEqual(input.selectedRange, selection)
            XCTAssertNotNil(element("composer-model-settings", in: window))
            capture(window, "busy-transcript-restored-\(scheme)")


            XCTAssertTrue(activate(try XCTUnwrap(element("composer-model-settings", in: window))))
            await settle(window)
            XCTAssertTrue(activate(try XCTUnwrap(element("model-quick-advanced", in: window))))
            await settle(window)
            XCTAssertNil(modelOverlay(in: window))
            XCTAssertFalse(input.isFirstResponder)
            XCTAssertEqual(input.text, draft)
            XCTAssertNotNil(element("model-settings-browse", in: window))
            XCTAssertFalse(objects(in: window).contains { $0.accessibilityLabel == "Done" })
            capture(window, "busy-transcript-advanced-\(scheme)")
        }
    }

    func testConfirmedSelectionUpdatesActualComposerAndRejectionKeepsIt() async throws {
        let server = try ModelFixtureServer(catalog: Self.catalog)
        let port = try await server.start()
        defer { server.stop() }
        let store = LocalStore(inMemory: true)
        try store.upsertSession(PersistedSession(
            environmentId: "model-fixture", environmentLabel: "Isolated model fixture",
            httpBaseUrl: "http://localhost:\(port)", wsBaseUrl: "ws://localhost:\(port)",
            sessionId: "model-fixture", deviceId: "model-fixture", keychainAccount: "model-fixture-no-token",
            protocolVersion: 1, capabilities: []
        ))
        let snapshot = EnvironmentSnapshot(
            environment: EnvironmentInfo(id: "model-fixture", label: "Isolated model fixture",
                                         hostVersion: nil, protocolVersion: 1, capabilities: [], cursor: 1),
            projects: [], threads: [server.thread], activeRuns: [], pendingApprovals: [], pendingQuestions: [],
            selectedTranscript: nil, cursor: 1
        )
        try store.saveSnapshot(environmentId: "model-fixture", rawJSON: JSONEncoder().encode(snapshot))
        let app = AppModel(store: store)
        app.gateway.requestProvider = { URLRequest(url: URL(string: "ws://localhost:\(port)")!) }
        app.gateway.helloProvider = { ClientHello(sessionId: "model-fixture", afterCursor: nil) }
        defer { app.gateway.disconnect() }
        try await app.gateway.ensureConnected()
        await app.loadModelsIfNeeded()
        await app.openThread("model-visual", title: "Model controls")
        let chat = try XCTUnwrap(app.activeChat)
        let window = host(ModelComposerFixture(chat: chat).environment(app), scheme: .light)
        defer { close(window) }
        await settle(window)
        XCTAssertEqual(app.currentModel(forThread: chat.threadId)?.id, "model-a")
        XCTAssertTrue(activate(try XCTUnwrap(element("composer-model-settings", in: window))))
        await settle(window)
        XCTAssertTrue(activate(try XCTUnwrap(element("model-quick-advanced", in: window))))
        await settle(window)
        XCTAssertTrue(activate(try XCTUnwrap(element("model-settings-browse", in: window))))
        await settle(window)
        capture(window, "transport-choices-before")
        XCTAssertTrue(activate(try XCTUnwrap(element("model-option-codex:model-b", in: window))))
        await settle(window)
        XCTAssertEqual(server.modelChanges, ["model-b"])
        XCTAssertEqual(app.currentModel(forThread: chat.threadId)?.id, "model-b")
        XCTAssertNotNil(element("model-settings-model", in: window), "Confirmed selection returns to Advanced.")
        XCTAssertNil(app.models.selectionErrors[chat.threadId])
        capture(window, "transport-confirmed-advanced")
        XCTAssertTrue(escape(in: window), "The Advanced drawer must dismiss through its escape action.")
        await settle(window)
        let trigger = try XCTUnwrap(element("composer-model-settings", in: window))
        XCTAssertTrue(trigger.accessibilityValue?.contains("Model B") == true,
                      "The composer must reflect the confirmed response without waiting for a REST snapshot.")
        capture(window, "transport-confirmed-composer")

        server.rejectNextModelChange = true
        XCTAssertTrue(activate(trigger))
        await settle(window)
        XCTAssertTrue(activate(try XCTUnwrap(element("model-quick-advanced", in: window))))
        await settle(window)
        XCTAssertTrue(activate(try XCTUnwrap(element("model-settings-browse", in: window))))
        await settle(window)
        XCTAssertTrue(activate(try XCTUnwrap(element("model-option-codex:model-a", in: window))))
        await settle(window)
        XCTAssertEqual(app.currentModel(forThread: chat.threadId)?.id, "model-b")
        XCTAssertEqual(app.models.selectionErrors[chat.threadId], "Sign in to this provider in Studio.")
        XCTAssertNotNil(element("model-selection-error", in: window))
        XCTAssertNotNil(element("model-option-codex:model-a", in: window))
        capture(window, "transport-rejected-selection")
    }

    func testCollapsedComposerQuickControlAndModelFailure() async throws {
        for scheme in [ColorScheme.light, .dark] {
            let app = AppModel(store: LocalStore(inMemory: true))
            await app.models.load { Self.catalog }
            let chat = ChatModel(threadId: "model-visual", title: "Model controls", app: app)
            let window = host(ModelComposerFixture(chat: chat).environment(app), scheme: scheme)
            defer { close(window) }
            await settle(window)

            let input = try XCTUnwrap(firstTextView(in: window))
            XCTAssertFalse(input.isFirstResponder)
            let trigger = try XCTUnwrap(element("composer-model-settings", in: window))
            XCTAssertGreaterThanOrEqual(trigger.accessibilityFrame.width, 44)
            XCTAssertGreaterThanOrEqual(trigger.accessibilityFrame.height, 44)
            let beforeInput = input.convert(input.bounds, to: window)
            let beforeTranscript = try XCTUnwrap(element("model-fixture-transcript", in: window)).accessibilityFrame
            capture(window, "collapsed-\(scheme)")

            XCTAssertTrue(activate(trigger), "The collapsed composer model control must respond.")
            await settle(window)
            let advanced = try XCTUnwrap(element("model-quick-advanced", in: window))
            let slider = try XCTUnwrap(element("model-effort-slider", in: window))
            XCTAssertFalse(input.isFirstResponder)
            XCTAssertEqual(input.convert(input.bounds, to: window), beforeInput)
            XCTAssertEqual(element("model-fixture-transcript", in: window)?.accessibilityFrame, beforeTranscript)
            let overlay = try XCTUnwrap(modelOverlay(in: window))
            XCTAssertFalse(overlay.isKeyWindow)
            XCTAssertTrue(window.isKeyWindow)
            XCTAssertGreaterThan(slider.accessibilityFrame.maxY, beforeInput.minY,
                                 "The quick control replaces the composer instead of sitting above it.")
            XCTAssertEqual(app.resolvedEffort(forThread: chat.threadId), "high")
            slider.accessibilityIncrement()
            await settle(window)
            XCTAssertEqual(app.resolvedEffort(forThread: chat.threadId), "max")
            capture(window, "quick-max-\(scheme)")

            XCTAssertTrue(activate(advanced))
            await settle(window)
            XCTAssertFalse(input.isFirstResponder)
            let modelRow = try XCTUnwrap(element("model-settings-model", in: window))
            XCTAssertNotNil(element("model-settings-intelligence", in: window))
            XCTAssertNotNil(element("model-settings-speed", in: window))
            capture(window, "advanced-\(scheme)")

            XCTAssertGreaterThanOrEqual(modelRow.accessibilityFrame.height, 44)
            XCTAssertTrue(activate(try XCTUnwrap(element("model-settings-browse", in: window))))
            await settle(window)
            let choice = try XCTUnwrap(element("model-option-codex:model-b", in: window))
            XCTAssertNotNil(element("model-option-codex:model-a", in: window))
            XCTAssertNil(element("model-option-claude:other-model", in: window),
                         "An established provider must not leak another provider's model choices.")
            capture(window, "model-choices-\(scheme)")
            XCTAssertTrue(activate(choice))
            await settle(window)
            XCTAssertNotNil(element("model-selection-error", in: window),
                            "A failed model update must be visible instead of silently closing the picker.")
            XCTAssertEqual(app.currentModel(forThread: chat.threadId)?.id, "model-a")
            XCTAssertNil(app.models.pendingSelections[chat.threadId])
            capture(window, "selection-failure-\(scheme)")
        }
    }

    func testQuickControlKeepsKeyboardAndAdvancedDismissesIt() async throws {
        let app = AppModel(store: LocalStore(inMemory: true))
        await app.models.load { Self.catalog }
        let chat = ChatModel(threadId: "model-visual", title: "Keyboard controls", app: app)
        let window = host(ModelComposerFixture(chat: chat).environment(app), scheme: .light)
        defer { close(window) }
        await settle(window)
        let input = try XCTUnwrap(firstTextView(in: window))
        XCTAssertTrue(input.becomeFirstResponder())
        await settle(window)
        XCTAssertTrue(input.isFirstResponder)
        let beforeInput = input.convert(input.bounds, to: window)
        capture(window, "keyboard-before")

        XCTAssertTrue(activate(try XCTUnwrap(element("composer-model-settings", in: window))))
        await settle(window)
        XCTAssertTrue(input.isFirstResponder, "Quick intelligence changes must keep the draft keyboard.")
        XCTAssertEqual(input.convert(input.bounds, to: window), beforeInput)
        let advanced = try XCTUnwrap(element("model-quick-advanced", in: window))
        let slider = try XCTUnwrap(element("model-effort-slider", in: window))
        XCTAssertGreaterThan(slider.accessibilityFrame.maxY, beforeInput.minY)
        XCTAssertFalse(try XCTUnwrap(modelOverlay(in: window)).isKeyWindow)
        capture(window, "keyboard-quick")

        XCTAssertTrue(activate(advanced))
        await settle(window)
        XCTAssertFalse(input.isFirstResponder, "The keyboard must dismiss before presenting Advanced.")
        XCTAssertNotNil(element("model-settings-model", in: window))
        capture(window, "keyboard-dismissed-advanced")
    }

    func testLargeTextSettingsRemainReadableInBothAppearances() async throws {
        for scheme in [ColorScheme.light, .dark] {
            let app = AppModel(store: LocalStore(inMemory: true))
            await app.models.load { Self.catalog }
            let chat = ChatModel(threadId: "model-visual", title: "Large model controls", app: app)
            let window = host(
                ModelComposerFixture(chat: chat)
                    .environment(app)
                    .environment(\.dynamicTypeSize, .accessibility1),
                scheme: scheme,
                largeText: true
            )
            defer { close(window) }
            await settle(window)
            XCTAssertTrue(activate(try XCTUnwrap(element("composer-model-settings", in: window))))
            await settle(window)
            let advanced = try XCTUnwrap(element("model-quick-advanced", in: window))
            XCTAssertTrue(window.bounds.contains(advanced.accessibilityFrame),
                          "The larger-text quick control must stay on screen.")
            capture(window, "large-text-quick-\(scheme)")
            XCTAssertTrue(activate(advanced))
            await settle(window)
            let row = try XCTUnwrap(element("model-settings-model", in: window))
            XCTAssertGreaterThanOrEqual(row.accessibilityFrame.height, 44)
            capture(window, "large-text-advanced-\(scheme)")
        }
    }

    func testEmptyCatalogShowsRetryAndRecoversWhileOpen() async throws {
        let app = AppModel(store: LocalStore(inMemory: true))
        let chat = ChatModel(threadId: "model-visual", title: "Retry controls", app: app)
        let window = host(ModelComposerFixture(chat: chat).environment(app), scheme: .light)
        defer { close(window) }
        await settle(window)
        let trigger = try XCTUnwrap(element("composer-model-settings", in: window))
        XCTAssertTrue(activate(trigger), "Empty discovery must never disable the only way to retry.")
        await settle(window)
        let retry = try XCTUnwrap(element("model-load-retry", in: window))
        XCTAssertNotNil(app.models.loadError)
        capture(window, "empty-catalog-retry")
        XCTAssertTrue(activate(retry))
        await settle(window)
        XCTAssertFalse(app.models.isLoading)
        XCTAssertNotNil(element("model-load-retry", in: window))

        // Deliver a recovered catalog to the same store while the actual
        // quick control remains mounted; no view reconstruction is needed.
        await app.models.load(force: true) { Self.catalog }
        await settle(window)
        XCTAssertNil(app.models.loadError)
        XCTAssertNil(element("model-load-retry", in: window))
        XCTAssertNotNil(element("model-effort-slider", in: window))
        XCTAssertTrue(element("model-quick-advanced", in: window)?.accessibilityValue?.contains("Model A") == true)
        capture(window, "catalog-recovered")
    }

    func testPendingSelectionAndConfirmedStoreState() async throws {
        let app = AppModel(store: LocalStore(inMemory: true))
        await app.models.load { Self.catalog }
        let window = host(
            ModelQuickControls(threadId: "model-visual", onAdvanced: {})
                .padding(20)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(DS.Color.bg)
                .environment(app),
            scheme: .light
        )
        defer { close(window) }
        await settle(window)
        var confirmation: CheckedContinuation<ThreadInfo, Error>?
        let started = expectation(description: "Selection is awaiting Studio confirmation")
        let mutation = Task {
            await app.models.select(
                Self.catalog[1], threadId: "model-visual", currentProviderId: "codex", canChangeProvider: false
            ) {
                try await withCheckedThrowingContinuation {
                    confirmation = $0
                    started.fulfill()
                }
            }
        }
        await fulfillment(of: [started])
        await settle(window)
        XCTAssertEqual(app.models.pendingSelections["model-visual"], "codex:model-b")
        let slider = try XCTUnwrap(element("model-effort-slider", in: window))
        XCTAssertTrue(slider.accessibilityTraits.contains(.notEnabled))
        slider.accessibilityIncrement()
        await settle(window)
        XCTAssertEqual(app.resolvedEffort(forThread: "model-visual"), "high", "A pending model change disables effort updates.")
        capture(window, "selection-pending")
        confirmation?.resume(returning: ThreadInfo(
            id: "model-visual", projectId: "project", title: "Model controls", updatedAt: 2,
            modelName: "model-b", providerId: "codex"
        ))
        let confirmed = await mutation.value
        XCTAssertEqual(confirmed?.modelName, "model-b")
        XCTAssertNil(app.models.pendingSelections["model-visual"])
        await settle(window)
        XCTAssertFalse(try XCTUnwrap(element("model-effort-slider", in: window)).accessibilityTraits.contains(.notEnabled))
        capture(window, "selection-confirmed-store")
    }

    private static var newChatCatalog: [ModelOption] {
        [
            ModelOption(id: "shared", label: "Codex Shared", providerId: "codex", providerLabel: "Codex",
                        isDefault: true, reasoningEfforts: ["low", "high", "max"],
                        approvalPolicyOptions: newChatApprovals, defaultApprovalPolicy: "ask-first", defaultReasoningEffort: "high"),
            ModelOption(id: "alternate", label: "Codex Alternate", providerId: "codex", providerLabel: "Codex",
                        isDefault: false, reasoningEfforts: ["medium", "high"],
                        approvalPolicyOptions: newChatApprovals, defaultApprovalPolicy: "ask-first"),
            ModelOption(id: "shared", label: "Claude Shared", providerId: "claude", providerLabel: "Claude",
                        isDefault: false, reasoningEfforts: ["low", "high"],
                        approvalPolicyOptions: nil, defaultApprovalPolicy: nil, defaultReasoningEffort: "low"),
            ModelOption(id: "simple", label: "Claude Simple", providerId: "claude", providerLabel: "Claude",
                        isDefault: false, reasoningEfforts: nil,
                        approvalPolicyOptions: nil, defaultApprovalPolicy: nil),
        ]
    }

    private static var newChatApprovals: [ApprovalPolicyOption] {
        [ApprovalPolicyOption(value: "ask-first", label: "Ask first"),
         ApprovalPolicyOption(value: "full-access", label: "Full access")]
    }

    private static var catalog: [ModelOption] {
        [
            ModelOption(id: "model-a", label: "Model A", providerId: "codex", providerLabel: "Codex",
                        isDefault: true, reasoningEfforts: ["low", "medium", "high", "max"],
                        approvalPolicyOptions: nil, defaultApprovalPolicy: nil,
                        defaultReasoningEffort: "high", supportsFastMode: true),
            ModelOption(id: "model-b", label: "Model B", providerId: "codex", providerLabel: "Codex",
                        isDefault: false, reasoningEfforts: ["low", "high"],
                        approvalPolicyOptions: nil, defaultApprovalPolicy: nil),
            ModelOption(id: "other-model", label: "Other provider model", providerId: "claude", providerLabel: "Claude",
                        isDefault: false, reasoningEfforts: ["low", "high"],
                        approvalPolicyOptions: nil, defaultApprovalPolicy: nil),
        ]
    }

    private static var referenceModel: ModelOption {
        ModelOption(id: "reference-model", label: "6 Astra", providerId: "codex", providerLabel: "Codex",
                    isDefault: true, reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
                    approvalPolicyOptions: nil, defaultApprovalPolicy: nil,
                    defaultReasoningEffort: "max", supportsFastMode: true)
    }

    private func host<Content: View>(_ content: Content, scheme: ColorScheme, largeText: Bool = false) -> UIWindow {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
            ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first!
        let window = UIWindow(windowScene: scene)
        window.frame = scene.screen.bounds
        window.accessibilityIdentifier = "model-fixture-window"
        window.overrideUserInterfaceStyle = scheme == .dark ? .dark : .light
        if largeText { window.traitOverrides.preferredContentSizeCategory = .accessibilityMedium }
        let controller = UIHostingController(rootView: content.environment(\.colorScheme, scheme))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.frame = window.bounds
        controller.view.backgroundColor = .clear
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
        try? await Task.sleep(for: .milliseconds(450))
        window.setNeedsLayout()
        window.layoutIfNeeded()
    }

    private func capture(_ window: UIWindow, _ name: String) {
        let image = UIGraphicsImageRenderer(size: window.bounds.size).image { context in
            for sceneWindow in sceneWindows(in: window) {
                context.cgContext.saveGState()
                let origin = sceneWindow.convert(sceneWindow.bounds.origin, to: window)
                context.cgContext.translateBy(x: origin.x, y: origin.y)
                sceneWindow.drawHierarchy(in: sceneWindow.bounds, afterScreenUpdates: true)
                context.cgContext.restoreGState()
            }
        }
        let screenshot = XCTAttachment(image: image)
        screenshot.name = "model-settings-\(name)"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let windowDiagnostics = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap { scene in
                scene.windows.map { sceneWindow in
                    let root = sceneWindow.rootViewController?.view
                    return "WINDOW type=\(type(of: sceneWindow)) id=\(sceneWindow.accessibilityIdentifier ?? "") level=\(sceneWindow.windowLevel.rawValue) key=\(sceneWindow.isKeyWindow) hidden=\(sceneWindow.isHidden) frame=\(sceneWindow.frame) bounds=\(sceneWindow.bounds) safeArea=\(sceneWindow.safeAreaInsets) rootType=\(root.map { String(describing: type(of: $0)) } ?? "nil") rootFrame=\(root?.frame ?? .zero) rootBounds=\(root?.bounds ?? .zero) rootSafeArea=\(root?.safeAreaInsets ?? .zero)"
                }
            }.joined(separator: "\n")
        let hierarchy = windowDiagnostics + "\n\n" + objects(in: window).map { object in
            let id = (object as? UIAccessibilityIdentification)?.accessibilityIdentifier ?? ""
            return "\(type(of: object)) id=\(id) label=\(object.accessibilityLabel ?? "") value=\(object.accessibilityValue ?? "") frame=\(object.accessibilityFrame) traits=\(object.accessibilityTraits.rawValue)"
        }.joined(separator: "\n")
        if name.hasPrefix("busy-transcript-keyboard-quick") {
            print("MODEL_WINDOW_DIAGNOSTICS \(name)\n\(windowDiagnostics)")
        }
        let tree = XCTAttachment(string: hierarchy)
        tree.name = "model-settings-\(name)-hierarchy"
        tree.lifetime = .keepAlways
        add(tree)
        let evidence = FileManager.default.temporaryDirectory.appendingPathComponent("model-ui-evidence", isDirectory: true)
        try? FileManager.default.createDirectory(at: evidence, withIntermediateDirectories: true)
        try? image.pngData()?.write(to: evidence.appendingPathComponent("\(name).png"))
        try? hierarchy.write(to: evidence.appendingPathComponent("\(name).txt"), atomically: true, encoding: .utf8)
    }

    private func node(labeled label: String, in window: UIWindow) -> NSObject? {
        objects(in: window).first { $0.accessibilityLabel == label }
    }

    private func replace(_ input: UITextView, with text: String) {
        if let range = input.textRange(from: input.beginningOfDocument, to: input.endOfDocument) {
            input.replace(range, withText: text)
        } else {
            input.text = text
            input.delegate?.textViewDidChange?(input)
        }
    }

    private func element(_ identifier: String, in window: UIWindow) -> NSObject? {
        let nodes = objects(in: window)
        if let exact = nodes.first(where: {
            ($0 as? UIAccessibilityIdentification)?.accessibilityIdentifier == identifier
        }) { return exact }
        // SwiftUI's hosted accessibility nodes omit automation identifiers in
        // this XCTest host. Match their exposed labels and traits as a fallback.
        let match = nodes.first { node in
            let label = node.accessibilityLabel ?? ""
            switch identifier {
            case "new-chat-model-settings": return label == "Provider, model, and intelligence"
            case "composer-model-settings": return label == "Model and intelligence"
            case "model-fixture-transcript": return label.hasPrefix("Transcript stays in place")
            case "model-quick-advanced": return label == "Advanced model settings"
            case "model-effort-slider": return label == "Intelligence" && node.accessibilityTraits.contains(.adjustable)
            case "model-settings-model": return label.hasPrefix("Model,") && node.accessibilityTraits.contains(.button)
            case "model-settings-browse": return label == "Browse models" && node.accessibilityTraits.contains(.button)
            case "model-settings-intelligence": return label.hasPrefix("Intelligence,")
            case "model-settings-speed": return label.hasPrefix("Speed,")
            case "model-option-codex:model-a": return label == "Model A" && node.accessibilityTraits.contains(.button)
            case "model-option-codex:model-b": return label == "Model B" && node.accessibilityTraits.contains(.button)
            case "model-option-claude:other-model": return label == "Other provider model" && node.accessibilityTraits.contains(.button)
            case "model-load-retry": return label == "Retry" && node.accessibilityTraits.contains(.button)
            case "model-selection-error":
                return label == GraftError.notPaired.localizedDescription || label == "Sign in to this provider in Studio."
            default: return false
            }
        }
        if match == nil { capture(window, "lookup-\(identifier.replacingOccurrences(of: ":", with: "-"))") }
        return match
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
        if let window = root as? UIWindow {
            sceneWindows(in: window).reversed().forEach(visit)
        } else {
            visit(root)
        }
        return result
    }

    private func sceneWindows(in window: UIWindow) -> [UIWindow] {
        (window.windowScene?.windows ?? [window])
            .filter { !$0.isHidden && ($0 === window || $0.windowLevel > window.windowLevel) }
            .sorted { $0.windowLevel < $1.windowLevel }
    }

    private func visibleMenuLabels(in window: UIWindow) -> Set<String> {
        // UIKit retains the dismissed menu's accessibility mock elements and
        // hidden views. Only visible native rows belong to the current menu.
        Set(objects(in: window).compactMap { object in
            guard let view = object as? UIView, view.window != nil else { return nil }
            var ancestor: UIView? = view
            while let current = ancestor {
                guard !current.isHidden, current.alpha > 0.01 else { return nil }
                ancestor = current.superview
            }
            return view.accessibilityLabel
        })
    }

    private func modelOverlay(in window: UIWindow) -> UIWindow? {
        window.windowScene?.windows.first {
            !$0.isHidden && $0.accessibilityIdentifier == "model-controls-window"
        }
    }

    private func escape(in window: UIWindow) -> Bool {
        if let overlay = modelOverlay(in: window) {
            return overlay.rootViewController?.accessibilityPerformEscape() == true
        }
        if objects(in: window).contains(where: { $0.accessibilityPerformEscape() }) { return true }
        return window.rootViewController?.presentedViewController?.accessibilityPerformEscape() == true
    }

    private func activate(_ object: NSObject) -> Bool {
        if let control = object as? UIControl {
            control.sendActions(for: .touchUpInside)
            return true
        }
        if object.accessibilityActivate() { return true }
        return (object.accessibilityCustomActions ?? []).contains { $0.actionHandler?($0) == true }
    }

    private func firstTextView(in view: UIView) -> UITextView? {
        if let input = view as? UITextView, input.isEditable { return input }
        return view.subviews.lazy.compactMap { self.firstTextView(in: $0) }.first
    }
}


/// A loopback WebSocket fixture exercises the production GatewayClient and
/// AppModel command/confirmation path without contacting a user's Studio.
@MainActor
private final class ModelFixtureServer {
    let catalog: [ModelOption]
    private let listener: NWListener
    private var connections: [NWConnection] = []
    private(set) var modelChanges: [String] = []
    var rejectNextModelChange = false
    private(set) var thread = ThreadInfo(
        id: "model-visual", projectId: "project", title: "Model controls", updatedAt: 1,
        modelName: "model-a", providerId: "codex"
    )

    init(catalog: [ModelOption]) throws {
        self.catalog = catalog
        let parameters = NWParameters.tcp
        let webSocket = NWProtocolWebSocket.Options()
        webSocket.autoReplyPing = true
        parameters.defaultProtocolStack.applicationProtocols.insert(webSocket, at: 0)
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        listener = try NWListener(using: parameters)
    }

    func start() async throws -> UInt16 {
        listener.newConnectionHandler = { [weak self] connection in
            Task { @MainActor in
                guard let self else { return }
                self.connections.append(connection)
                connection.start(queue: .main)
                self.receive(connection)
            }
        }
        return try await withCheckedThrowingContinuation { continuation in
            var finished = false
            listener.stateUpdateHandler = { [weak self] state in
                Task { @MainActor in
                    guard !finished else { return }
                    if case .ready = state, let port = self?.listener.port {
                        finished = true
                        continuation.resume(returning: port.rawValue)
                    } else if case .failed(let error) = state {
                        finished = true
                        continuation.resume(throwing: error)
                    }
                }
            }
            listener.start(queue: .main)
        }
    }

    func stop() {
        listener.cancel()
        connections.forEach { $0.cancel() }
    }

    private func receive(_ connection: NWConnection) {
        connection.receiveMessage { [weak self] data, _, _, error in
            Task { @MainActor in
                guard let self, error == nil else { return }
                if let data { self.handle(data, connection: connection) }
                self.receive(connection)
            }
        }
    }

    private func handle(_ data: Data, connection: NWConnection) {
        guard let frame = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if frame["envelope"] as? String == "hello" {
            send(HostWelcome(envelope: "welcome", protocolVersion: 1, capabilities: [],
                             environmentId: "model-fixture", environmentLabel: "Isolated model fixture", cursor: 1),
                 to: connection)
            return
        }
        guard let command = try? JSONDecoder().decode(ClientCommandEnvelope.self, from: data) else { return }
        var result: CommandResult
        var receipt = CommandReceipt(commandId: command.commandId, status: "completed", runId: nil, cursor: nil)
        switch command.command {
        case .modelsList:
            result = CommandResult(type: "models.list.result", run: nil, diff: nil, thread: nil, models: catalog)
        case .threadSetModel(let selection):
            modelChanges.append(selection.modelId)
            if rejectNextModelChange {
                rejectNextModelChange = false
                receipt = CommandReceipt(commandId: command.commandId, status: "rejected", runId: nil, cursor: nil,
                                         errorCode: "provider_unavailable", message: "Sign in to this provider in Studio.")
            } else {
                thread = ThreadInfo(id: thread.id, projectId: thread.projectId, title: thread.title,
                                    updatedAt: thread.updatedAt + 1, modelName: selection.modelId,
                                    providerId: selection.providerId)
            }
            result = CommandResult(type: "thread.set_model.result", run: nil, diff: nil, thread: thread, models: nil)
        case .composerCommands:
            result = CommandResult(type: "composer.commands.result", run: nil, diff: nil, thread: nil,
                                   models: nil, commands: [])
        default:
            return
        }
        send(HostResponseEnvelope(envelope: "response", commandId: command.commandId,
                                  requestId: command.requestId, receipt: receipt, result: result), to: connection)
    }

    private func send(_ response: some Encodable, to connection: NWConnection) {
        guard let data = try? JSONEncoder().encode(response) else { return }
        let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
        connection.send(content: data, contentContext: NWConnection.ContentContext(
            identifier: "model-fixture", metadata: [metadata]
        ), isComplete: true, completion: .contentProcessed { _ in })
    }
}

private struct ModelComposerFixture: View {
    let chat: ChatModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Model controls").font(.headline)
            Text("Transcript stays in place while you choose intelligence for the next message.")
                .accessibilityIdentifier("model-fixture-transcript")
            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DS.Color.bg)
        .safeAreaInset(edge: .bottom) {
            ComposerView(chat: chat, siblingChromeHeight: 0)
        }
    }
}
