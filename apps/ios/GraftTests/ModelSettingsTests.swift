import XCTest

@testable import Graft

@MainActor
final class ModelSettingsTests: XCTestCase {
    func testFailedDiscoveryCanRetryAndConcurrentLoadsShareRequest() async {
        let store = ModelSettingsStore()
        await store.load { throw GraftError.socketClosed }
        XCTAssertNotNil(store.loadError)
        XCTAssertFalse(store.isLoading)

        var continuation: CheckedContinuation<[ModelOption], Error>?
        let started = expectation(description: "Discovery started")
        let first = Task {
            await store.load {
                try await withCheckedThrowingContinuation {
                    continuation = $0
                    started.fulfill()
                }
            }
        }
        await fulfillment(of: [started])
        XCTAssertTrue(store.isLoading)
        let second = Task {
            await store.load {
                XCTFail("Concurrent controls must share discovery")
                return []
            }
        }
        await Task.yield()
        continuation?.resume(returning: [Self.model()])
        await first.value
        await second.value
        XCTAssertNil(store.loadError)
        XCTAssertFalse(store.isLoading)
        XCTAssertEqual(store.availableModels.map(\.id), ["model-a"])
    }

    func testRefreshFailureRetainsUsableCatalog() async {
        let store = ModelSettingsStore()
        await store.load { [Self.model()] }
        await store.load(force: true) { throw GraftError.timeout("Discovery stalled") }
        XCTAssertEqual(store.availableModels.count, 1)
        XCTAssertEqual(store.providerGroups.first?.models.map(\.id), ["model-a"])
        XCTAssertNotNil(store.loadError)
        await store.load(force: true) { [Self.model(id: "model-b")] }
        XCTAssertEqual(store.availableModels.first?.id, "model-b")
        XCTAssertEqual(store.providerGroups.first?.models.map(\.id), ["model-b"])
        XCTAssertNil(store.loadError)
    }

    func testProviderGroupsPreserveStudioOrderAndSeparateSharedModelIds() async throws {
        let store = ModelSettingsStore()
        let namedModel = try JSONDecoder().decode(ModelOption.self, from: Data(
            #"{"id":"shared","label":"Shared model","providerId":"cursor","providerLabel":"Cursor"}"#.utf8
        ))
        await store.load {
            [namedModel, Self.model(id: "shared", provider: "codex"),
             Self.model(id: "second", provider: "cursor")]
        }
        XCTAssertEqual(store.providerGroups.map(\.id), ["cursor", "codex"])
        XCTAssertEqual(store.providerGroups.map(\.label), ["Cursor", "codex"])
        XCTAssertEqual(store.providerGroups[0].models.map(\.selectionID), ["cursor:shared", "cursor:second"])
        XCTAssertEqual(store.providerGroups[1].models.map(\.selectionID), ["codex:shared"])
        store.reset()
        XCTAssertTrue(store.providerGroups.isEmpty)
    }

    func testEmptyCatalogExposesRetryState() async {
        let store = ModelSettingsStore()
        await store.load { [] }
        XCTAssertNotNil(store.loadError)
        XCTAssertFalse(store.isLoading)
        await store.load { [Self.model()] }
        XCTAssertNil(store.loadError)
    }

    func testResetIgnoresPreviousHostsLateCatalog() async {
        let store = ModelSettingsStore()
        var continuation: CheckedContinuation<[ModelOption], Error>?
        let started = expectation(description: "Old host discovery started")
        let old = Task {
            await store.load {
                try await withCheckedThrowingContinuation {
                    continuation = $0
                    started.fulfill()
                }
            }
        }
        await fulfillment(of: [started])
        store.reset()
        await store.load { [Self.model(id: "new-host-model")] }
        continuation?.resume(returning: [Self.model(id: "old-host-model")])
        await old.value
        XCTAssertEqual(store.availableModels.map(\.id), ["new-host-model"])
        XCTAssertFalse(store.isLoading)
    }

    func testSelectionWaitsForConfirmationAndPreventsRacingChanges() async {
        let store = ModelSettingsStore()
        var continuation: CheckedContinuation<ThreadInfo, Error>?
        let started = expectation(description: "Model mutation sent")
        let selection = Task {
            await store.select(Self.model(), threadId: "thread", currentProviderId: "codex", canChangeProvider: false) {
                try await withCheckedThrowingContinuation {
                    continuation = $0
                    started.fulfill()
                }
            }
        }
        await fulfillment(of: [started])
        XCTAssertEqual(store.pendingSelections["thread"], "codex:model-a")
        let raced = await store.select(Self.model(id: "model-b"), threadId: "thread", currentProviderId: "codex", canChangeProvider: false) {
            XCTFail("A second mutation cannot race the first")
            return Self.thread()
        }
        XCTAssertNil(raced)
        continuation?.resume(returning: Self.thread())
        let result = await selection.value
        XCTAssertEqual(result?.modelName, "model-a")
        XCTAssertNil(store.pendingSelections["thread"])
    }

    func testProviderLockAndRejectedSelectionStayVisible() async throws {
        let store = ModelSettingsStore()
        let locked = await store.select(Self.model(provider: "droid"), threadId: "thread", currentProviderId: "codex", canChangeProvider: false) {
            XCTFail("Established chats cannot change providers")
            return Self.thread()
        }
        XCTAssertNil(locked)
        XCTAssertEqual(store.selectionErrors["thread"], "Start a new chat to use a different provider.")
        let data = Data(#"{"commandId":"c","status":"rejected","errorCode":"provider_unavailable","message":"Sign in to this provider in Studio."}"#.utf8)
        let receipt = try JSONDecoder().decode(CommandReceipt.self, from: data)
        let rejected = await store.select(Self.model(), threadId: "thread", currentProviderId: "codex", canChangeProvider: false) {
            try receipt.checkAccepted()
            return Self.thread()
        }
        XCTAssertNil(rejected)
        XCTAssertEqual(store.selectionErrors["thread"], "Sign in to this provider in Studio.")
        XCTAssertNil(store.pendingSelections["thread"])
        let accepted = await store.select(Self.model(), threadId: "thread", currentProviderId: "codex", canChangeProvider: false) { Self.thread() }
        XCTAssertNotNil(accepted)
        XCTAssertNil(store.selectionErrors["thread"])
    }

    func testNewChatAllowsProviderSelection() async {
        let store = ModelSettingsStore()
        let result = await store.select(Self.model(provider: "droid"), threadId: "thread", currentProviderId: "codex", canChangeProvider: true) {
            ThreadInfo(id: "thread", projectId: "project", title: "New chat", updatedAt: 2, modelName: "model-a", providerId: "droid")
        }
        XCTAssertEqual(result?.providerId, "droid")
    }

    func testCapabilitiesDecodeAndTurnCarriesExplicitStandardSpeed() throws {
        let json = Data(#"{"id":"runtime-model","label":"Runtime model","providerId":"codex","reasoningEfforts":["low","max"],"defaultReasoningEffort":"max","supportsFastMode":true}"#.utf8)
        let model = try JSONDecoder().decode(ModelOption.self, from: json)
        XCTAssertEqual(model.defaultReasoningEffort, "max")
        XCTAssertEqual(model.supportsFastMode, true)
        let command = TurnStartCommand(threadId: "thread", text: "Continue", effort: "max", fastMode: false)
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(command)) as? [String: Any]
        XCTAssertEqual(encoded?["fastMode"] as? Bool, false)
        XCTAssertEqual(encoded?["effort"] as? String, "max")
    }

    private static func model(id: String = "model-a", provider: String = "codex") -> ModelOption {
        ModelOption(id: id, label: id, providerId: provider, providerLabel: nil,
                    isDefault: true, reasoningEfforts: ["low", "high", "max"],
                    approvalPolicyOptions: nil, defaultApprovalPolicy: nil)
    }

    private static func thread() -> ThreadInfo {
        ThreadInfo(id: "thread", projectId: "project", title: "Chat", updatedAt: 2,
                   modelName: "model-a", providerId: "codex")
    }
}
