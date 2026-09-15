import Foundation
import SwiftUI

/// Root observable model: owns the `ConnectionStore`, the `GatewayClient`,
/// and the local `LocalStore`. One instance lives for the app lifetime.
///
/// `scenePhase` hooks (`active` / `background`) drive the socket lifecycle:
/// - `.active` → `reconnectIfNeeded()` — nudges a stale socket back to life
/// - `.background` → `gateway.suspendForBackground()` — tears down the socket
///   so iOS doesn't kill us for burning background runtime
@MainActor
@Observable
final class AppModel {
    let store: LocalStore
    let connection: ConnectionStore
    let gateway: GatewayClient
    let speaker = SpeakerModel()
    let settings = ChatSettings()
    let auth = AuthStore()

    /// Current environment snapshot received after the WebSocket handshake.
    private(set) var snapshot: EnvironmentSnapshot?

    /// Thread whose transcript should be included in authoritative refreshes.
    private(set) var selectedThreadId: String?

    /// The chat pipeline for the open thread; nil when no thread is open.
    private(set) var activeChat: ChatModel?

    /// REST client for media/asset fetches; nil until paired.
    var rest: RESTClient? { connection.restClient }

    /// Text-to-speech backend. The Graft host has no speech endpoint yet, so
    /// speak affordances stay hidden while this is nil.
    var tts: (any TTSSynthesizer)? { nil }

    /// Non-nil when the gateway emits a host-level error.
    private(set) var gatewayError: GraftError?

    private var snapshotRefreshTask: Task<Void, Never>?
    private var commandWaiters: [String: CheckedContinuation<HostResponseEnvelope, Error>] = [:]

    var isPaired: Bool { connection.isPaired }

    init(store: LocalStore? = nil, gateway: GatewayClient? = nil) {
        let resolvedStore = store ?? LocalStore()
        self.store = resolvedStore
        self.gateway = gateway ?? GatewayClient()
        connection = ConnectionStore(store: resolvedStore)
        hydrateCachedSnapshot()
        wireGateway()
    }

    // MARK: Scene phase

    /// Called from `RootView.onChange(of: scenePhase)`.
    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .active:
            resumeFromBackground()
        case .background:
            suspendForBackground()
        case .inactive:
            break
        @unknown default:
            break
        }
    }

    func reconnectIfNeeded() {
        guard isPaired else { return }
        gateway.nudge()
    }

    func suspendForBackground() {
        AppLog.networking.info("App backgrounded — suspending gateway")
        gateway.suspendForBackground()
    }

    func resumeFromBackground() {
        AppLog.networking.info("App foregrounded — reconnecting gateway")
        reconnectIfNeeded()
    }

    func unpair() async {
        guard await connection.unpair() else {
            gatewayError = connection.pairingError
            return
        }
        gateway.disconnect()
        // `disconnect()` tears down without broadcasting, so fail waiters here.
        failPendingCommands()
        snapshotRefreshTask?.cancel()
        snapshotRefreshTask = nil
        snapshot = nil
        activeChat = nil
        selectedThreadId = nil
        gatewayError = nil
    }

    func openThread(_ threadId: String, title: String = "") async {
        selectedThreadId = threadId
        if activeChat?.threadId != threadId {
            activeChat = ChatModel(threadId: threadId, title: title, app: self)
            if let snapshot {
                activeChat?.applySnapshot(snapshot)
            }
            hydrateCachedTranscript(threadId)
        }
        await refreshSnapshot()
    }

    /// Paint the last-known transcript from disk while `refreshSnapshot`
    /// round-trips; a no-op when the environment snapshot already carried
    /// this thread's transcript.
    private func hydrateCachedTranscript(_ threadId: String) {
        guard let chat = activeChat, chat.threadId == threadId else { return }
        do {
            guard let transcript = try store.decodedTranscript(threadId: threadId) else { return }
            chat.applyCachedTranscript(transcript)
        } catch {
            AppLog.persistence.warning(
                "Failed to restore cached transcript for \(threadId): \(error)"
            )
        }
    }

    func closeThread(_ threadId: String) {
        guard selectedThreadId == threadId else { return }
        selectedThreadId = nil
        activeChat = nil
        speaker.stop()
    }

    func startTurn(threadId: String, text: String) async -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        do {
            try await gateway.send(
                ClientCommandEnvelope(
                    command: .turnStart(
                        TurnStartCommand(
                            threadId: threadId,
                            text: trimmed,
                            effort: resolvedEffort(forThread: threadId)
                        )
                    )
                )
            )
            scheduleSnapshotRefresh()
            return true
        } catch let error as GraftError {
            gatewayError = error
            return false
        } catch {
            gatewayError = .unreachable(error.localizedDescription)
            return false
        }
    }

    func resolveApproval(id: String, decision: String) async -> Bool {
        do {
            try await gateway.send(
                ClientCommandEnvelope(
                    command: .approvalResolve(
                        ApprovalResolveCommand(
                            approvalId: id,
                            decision: decision
                        )
                    )
                )
            )
            scheduleSnapshotRefresh()
            return true
        } catch let error as GraftError {
            gatewayError = error
            return false
        } catch {
            gatewayError = .unreachable(error.localizedDescription)
            return false
        }
    }

    /// Models the host can run turns with — fetched once per connection and
    /// reused by every thread's model switcher.
    private(set) var availableModels: [ModelOption] = []

    func loadModelsIfNeeded() async {
        guard availableModels.isEmpty else { return }
        let envelope = ClientCommandEnvelope(command: .modelsList(ModelsListCommand()))
        do {
            let response = try await sendCommand(envelope)
            availableModels = response.result?.models ?? []
        } catch {
            // Non-fatal: the switcher just shows the thread's current model.
        }
    }

    /// Per-thread reasoning effort chosen on this phone. Deliberately not sent
    /// to the host until a turn starts — mirroring the desktop, where effort
    /// rides on each turn/start instead of living in the thread record.
    private(set) var threadEfforts: [String: String] = [:]

    func setThreadEffort(threadId: String, effort: String) {
        threadEfforts[threadId] = effort
    }

    /// The thread's current model, resolved against the host's catalog; a
    /// model unknown to the catalog still renders by its id.
    func currentModel(forThread threadId: String) -> ModelOption? {
        guard let thread = snapshot?.threads.first(where: { $0.id == threadId }) else {
            return availableModels.first { $0.isDefault == true }
                ?? availableModels.first
        }
        if let threadModelName = thread.modelName {
            if let match = availableModels.first(where: {
                $0.id == threadModelName && $0.providerId == thread.providerId
            }) ?? availableModels.first(where: { $0.id == threadModelName }) {
                return match
            }
            return ModelOption(
                id: threadModelName,
                label: Self.modelDisplayName(threadModelName),
                providerId: thread.providerId ?? "",
                providerLabel: nil,
                isDefault: nil,
                reasoningEfforts: nil,
                approvalPolicyOptions: nil,
                defaultApprovalPolicy: nil
            )
        }
        return availableModels.first { $0.isDefault == true }
            ?? availableModels.first
    }

    /// Strip wire-format suffixes ("[1m]") the desktop uses internally.
    static func modelDisplayName(_ id: String) -> String {
        id.replacingOccurrences(of: "[1m]", with: "")
    }

    /// Effort to send with the thread's next turn: the user's pick when still
    /// valid for the current model, "high" when offered, else the model's
    /// first effort. Nil when the model has no effort choice.
    func resolvedEffort(forThread threadId: String) -> String? {
        guard let efforts = currentModel(forThread: threadId)?.reasoningEfforts,
              !efforts.isEmpty
        else { return nil }
        if let picked = threadEfforts[threadId], efforts.contains(picked) {
            return picked
        }
        return efforts.contains("high") ? "high" : efforts.first
    }

    /// Point the thread at a different model for subsequent turns.
    func setThreadModel(threadId: String, model: ModelOption) async -> Bool {
        let envelope = ClientCommandEnvelope(
            command: .threadSetModel(
                ThreadSetModelCommand(
                    threadId: threadId,
                    modelId: model.id,
                    providerId: model.providerId
                )
            )
        )
        do {
            let response = try await sendCommand(envelope)
            if response.receipt?.status == "rejected" {
                return false
            }
            scheduleSnapshotRefresh()
            return true
        } catch let error as GraftError {
            gatewayError = error
            return false
        } catch {
            gatewayError = .unreachable(error.localizedDescription)
            return false
        }
    }

    /// The thread's current approval policy as the host reports it.
    func currentApprovalPolicy(forThread threadId: String) -> String? {
        snapshot?.threads.first { $0.id == threadId }?.approvalPolicy
    }

    /// Policies the permissions menu can offer for the thread's provider.
    func approvalPolicyOptions(forThread threadId: String) -> [ApprovalPolicyOption] {
        snapshot?.threads.first { $0.id == threadId }?.approvalPolicyOptions ?? []
    }

    /// Point the thread at a different approval policy for subsequent turns.
    func setThreadApproval(threadId: String, policy: String) async -> Bool {
        let envelope = ClientCommandEnvelope(
            command: .threadSetApproval(
                ThreadSetApprovalCommand(
                    threadId: threadId,
                    approvalPolicy: policy
                )
            )
        )
        do {
            let response = try await sendCommand(envelope)
            if response.receipt?.status == "rejected" {
                return false
            }
            scheduleSnapshotRefresh()
            return true
        } catch let error as GraftError {
            gatewayError = error
            return false
        } catch {
            gatewayError = .unreachable(error.localizedDescription)
            return false
        }
    }

    /// Create a thread in the given project on the host and return its summary,
    /// so the caller can navigate straight into it.
    func createThread(
        projectId: String,
        mode: String = "local",
        model: ModelOption? = nil,
        approvalPolicy: String? = nil
    ) async -> ThreadInfo? {
        let envelope = ClientCommandEnvelope(
            command: .threadCreate(
                ThreadCreateCommand(
                    projectId: projectId,
                    mode: mode,
                    modelId: model?.id,
                    providerId: model?.providerId,
                    approvalPolicy: approvalPolicy
                )
            )
        )
        do {
            let response = try await sendCommand(envelope)
            if response.receipt?.status == "rejected" {
                gatewayError = .hostError(
                    code: "command_rejected",
                    message: response.receipt?.status ?? "thread_create_rejected",
                    retryable: true
                )
                return nil
            }
            scheduleSnapshotRefresh()
            return response.result?.thread
        } catch let error as GraftError {
            gatewayError = error
            return nil
        } catch {
            gatewayError = .unreachable(error.localizedDescription)
            return nil
        }
    }

    /// Request a diff summary. `diffId` is typically a thread id (working tree)
    /// or a run id — matching the desktop adapter's lookup rules.
    func fetchDiff(diffId: String, filePath: String? = nil) async -> DiffSummary? {
        let envelope = ClientCommandEnvelope(
            command: .diffGet(DiffGetCommand(diffId: diffId, filePath: filePath))
        )
        do {
            let response = try await sendCommand(envelope)
            if response.receipt?.status == "rejected" {
                gatewayError = .hostError(
                    code: "command_rejected",
                    message: response.receipt?.status ?? "diff_get_rejected",
                    retryable: true
                )
                return nil
            }
            return response.result?.diff
        } catch let error as GraftError {
            gatewayError = error
            return nil
        } catch {
            gatewayError = .unreachable(error.localizedDescription)
            return nil
        }
    }

    private func sendCommand(
        _ envelope: ClientCommandEnvelope
    ) async throws -> HostResponseEnvelope {
        try await withCheckedThrowingContinuation { continuation in
            commandWaiters[envelope.commandId] = continuation
            Task { [weak self] in
                do {
                    try await self?.gateway.send(envelope)
                } catch {
                    guard let waiter = self?.commandWaiters.removeValue(
                        forKey: envelope.commandId
                    ) else { return }
                    waiter.resume(throwing: error)
                }
            }
        }
    }

    // MARK: Gateway wiring

    private func wireGateway() {
        gateway.requestProvider = { [weak self] in
            guard let self else { throw GraftError.notPaired }
            return try self.connection.webSocketRequest()
        }
        gateway.helloProvider = { [weak self] in
            guard let sessionId = self?.connection.session?.sessionId,
                  !sessionId.isEmpty
            else {
                throw GraftError.notPaired
            }
            return ClientHello(
                sessionId: sessionId,
                afterCursor: self?.snapshot?.cursor
            )
        }

        _ = gateway.addListener { [weak self] event in
            self?.handleGatewayEvent(event)
        }
    }

    private func handleGatewayEvent(_ event: GatewayEvent) {
        switch event.envelope {
        case "welcome":
            handleWelcome(event.payload)
        case "snapshot":
            handleSnapshot(event.payload)
        case "event":
            handleTimelineEvent(event.payload)
        case "snapshot_required":
            scheduleSnapshotRefresh(immediately: true)
        case "response":
            handleCommandResponse(event.payload)
        case "error":
            handleHostError(event.payload)
        case "gateway.disconnected":
            AppLog.networking.info("Gateway disconnected")
            failPendingCommands()
        default:
            break
        }
    }

    private func handleWelcome(_ data: Data) {
        guard let welcome = try? JSONDecoder().decode(HostWelcome.self, from: data) else { return }
        AppLog.networking.info("Gateway welcome from \(welcome.environmentLabel), cursor=\(welcome.cursor)")
        gatewayError = nil
        scheduleSnapshotRefresh(immediately: true)
    }

    private func handleSnapshot(_ data: Data) {
        guard let snap = try? JSONDecoder().decode(EnvironmentSnapshot.self, from: data) else { return }
        snapshot = snap
        activeChat?.applySnapshot(snap)
        persistSnapshot(snap, rawJSON: data)
    }

    /// A dropped socket means no response frame is ever coming for a command
    /// already on the wire. Without this, its continuation is never resumed:
    /// the caller (model change, thread creation, diff fetch) hangs forever
    /// and leaks the continuation after any transient network blip.
    private func failPendingCommands() {
        guard !commandWaiters.isEmpty else { return }
        let waiters = commandWaiters
        commandWaiters.removeAll()
        for waiter in waiters.values {
            waiter.resume(throwing: GraftError.socketClosed)
        }
    }

    private func handleCommandResponse(_ data: Data) {
        guard let response = try? JSONDecoder().decode(HostResponseEnvelope.self, from: data) else {
            scheduleSnapshotRefresh()
            return
        }
        if let waiter = commandWaiters.removeValue(forKey: response.commandId) {
            waiter.resume(returning: response)
        }
        // Keep the local replica fresh after mutations (turns, approvals, etc.).
        scheduleSnapshotRefresh()
    }

    private func handleTimelineEvent(_ data: Data) {
        guard let hostEvent = try? JSONDecoder().decode(HostEventEnvelope.self, from: data) else {
            AppLog.networking.warning("Ignoring malformed timeline event")
            return
        }
        // Streamed frames animate the open thread's in-flight turn directly;
        // the snapshot refresh below remains the authoritative reconcile.
        if let chat = activeChat, hostEvent.event.threadId == chat.threadId {
            chat.fold(hostEvent.event)
        }
        guard hostEvent.event.cursor > (snapshot?.cursor ?? 0) else {
            return
        }
        // The snapshot endpoint is authoritative for projects, threads, runs,
        // approvals, and transcript state. Coalesce bursts of streamed events
        // into one refresh rather than issuing an HTTP request per token.
        scheduleSnapshotRefresh()
    }

    private func handleHostError(_ data: Data) {
        guard let hostErr = try? JSONDecoder().decode(HostError.self, from: data) else { return }
        let detail = hostErr.error
        gatewayError = .hostError(
            code: detail.code,
            message: detail.message,
            retryable: detail.retryable ?? false
        )
        AppLog.networking.error("Host error: \(detail.code) — \(detail.message)")
        if detail.code == "device_revoked" || detail.code == "session_revoked" {
            Task { [weak self] in
                await self?.unpair()
            }
        }
    }

    // MARK: Snapshot synchronization

    private func hydrateCachedSnapshot() {
        guard let environmentId = connection.session?.environmentId else { return }
        do {
            snapshot = try store.decodedSnapshot(environmentId: environmentId)
            if let cursor = snapshot?.cursor {
                AppLog.persistence.info("Restored cached environment snapshot at cursor \(cursor)")
            }
        } catch {
            AppLog.persistence.error("Failed to restore cached environment snapshot: \(error)")
        }
    }

    private func scheduleSnapshotRefresh(immediately: Bool = false) {
        snapshotRefreshTask?.cancel()
        snapshotRefreshTask = Task { @MainActor [weak self] in
            if !immediately {
                try? await Task.sleep(for: .milliseconds(200))
            }
            guard !Task.isCancelled else { return }
            await self?.refreshSnapshot()
        }
    }

    private func refreshSnapshot() async {
        guard let client = connection.restClient else {
            gatewayError = .notPaired
            return
        }
        do {
            let refreshed = try await client.snapshot(threadId: selectedThreadId)
            snapshot = refreshed
            activeChat?.applySnapshot(refreshed)
            gatewayError = nil
            persistSnapshot(refreshed)
            AppLog.networking.debug(
                "Refreshed environment snapshot at cursor \(refreshed.cursor)"
            )
        } catch let error as GraftError {
            gatewayError = error
            AppLog.networking.warning(
                "Snapshot refresh failed: \(error.localizedDescription)"
            )
        } catch {
            gatewayError = .unreachable(error.localizedDescription)
            AppLog.networking.warning(
                "Snapshot refresh failed: \(error.localizedDescription)"
            )
        }
    }

    private func persistSnapshot(
        _ snapshot: EnvironmentSnapshot,
        rawJSON: Data? = nil
    ) {
        do {
            let data: Data
            if let rawJSON {
                data = rawJSON
            } else {
                data = try JSONEncoder().encode(snapshot)
            }
            try store.saveSnapshot(
                environmentId: snapshot.environment.id,
                rawJSON: data
            )
        } catch {
            AppLog.persistence.error("Failed to cache environment snapshot: \(error)")
        }
        guard let transcript = snapshot.selectedTranscript else { return }
        do {
            try store.saveTranscript(
                threadId: transcript.threadId,
                environmentId: snapshot.environment.id,
                rawJSON: try JSONEncoder().encode(transcript)
            )
        } catch {
            AppLog.persistence.error(
                "Failed to cache transcript for \(transcript.threadId): \(error)"
            )
        }
    }
}
