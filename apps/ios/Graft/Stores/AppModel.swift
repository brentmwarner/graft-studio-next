import Foundation
import SwiftUI

/// Per-computer observable model: owns its `ConnectionStore`, `GatewayClient`,
/// and chat state. `MachineStore` retains one instance per paired session.
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
    let sessionIdentity: String?
    var onUnpaired: (() -> Void)?
    let gateway: GatewayClient
    let speaker = SpeakerModel()
    let settings: ChatSettings
    let models = ModelSettingsStore()
    let auth: AuthStore
    private(set) var inboxReadState = InboxReadState()
    private var inboxReadEnvironmentId: String?
    private let readDefaults: UserDefaults
    private var inboxPendingAnswers: [String: String] = [:]
    private var isForeground = true
    private(set) var isConversationCovered = false

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
    private var snapshotRequestGeneration = 0
    private var commandTimeouts: [String: Task<Void, Never>] = [:]
    private var commandWaiters: [String: CheckedContinuation<HostResponseEnvelope, Error>] = [:]

    var isPaired: Bool { connection.isPaired }

    init(store: LocalStore? = nil, gateway: GatewayClient? = nil, readDefaults: UserDefaults = .standard, environmentId: String? = nil, loadSavedSession: Bool = true, settings: ChatSettings? = nil, auth: AuthStore? = nil) {
        self.readDefaults = readDefaults
        self.settings = settings ?? ChatSettings()
        self.auth = auth ?? AuthStore()
        let resolvedStore = store ?? LocalStore()
        self.store = resolvedStore
        self.gateway = gateway ?? GatewayClient()
        connection = ConnectionStore(store: resolvedStore, environmentId: environmentId, loadSavedSession: loadSavedSession)
        sessionIdentity = connection.session?.sessionId
        hydrateCachedSnapshot()
        wireGateway()
    }

    // MARK: Scene phase

    /// Called from `RootView.onChange(of: scenePhase)`.
    func scenePhaseChanged(_ phase: ScenePhase) {
        isForeground = phase == .active
        if isForeground { updateInboxReads() }
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

    func setConversationCovered(_ covered: Bool) {
        guard isConversationCovered != covered else { return }
        isConversationCovered = covered
        if !covered { updateInboxReads() }
    }

    func stop() {
        gateway.disconnect()
        failPendingCommands()
        snapshotRefreshTask?.cancel()
        snapshotRequestGeneration += 1
        activeChat = nil
        selectedThreadId = nil
        speaker.stop()
    }

    var connectionWarning: GraftError? {
        gatewayError.flatMap { $0.isOffline ? nil : $0 }
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
        guard sessionIdentity == nil || sessionIdentity == connection.session?.sessionId else {
            stop()
            onUnpaired?()
            return
        }
        guard await connection.unpair() else {
            gatewayError = connection.pairingError
            return
        }
        gateway.disconnect()
        // `disconnect()` tears down without broadcasting, so fail waiters here.
        failPendingCommands()
        snapshotRefreshTask?.cancel()
        snapshotRequestGeneration += 1
        snapshotRefreshTask = nil
        snapshot = nil
        inboxReadState = InboxReadState()
        inboxReadEnvironmentId = nil
        inboxPendingAnswers.removeAll()
        activeChat = nil
        selectedThreadId = nil
        gatewayError = nil
        models.reset()
        threadEfforts = [:]
        threadFastModes = [:]
        onUnpaired?()
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
        if gateway.state == .connected { await refreshSnapshot() }
    }

    /// Paint the last-known transcript from disk while `refreshSnapshot`
    /// round-trips; a no-op when the environment snapshot already carried
    /// this thread's transcript.
    private func hydrateCachedTranscript(_ threadId: String) {
        guard let chat = activeChat, chat.threadId == threadId else { return }
        do {
            guard let transcript = try store.decodedTranscript(threadId: threadId, environmentId: connection.session?.environmentId ?? "") else { return }
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
        guard !trimmed.isEmpty, models.pendingSelections[threadId] == nil else { return false }
        do {
            let response = try await sendCommand(
                ClientCommandEnvelope(
                    command: .turnStart(
                        TurnStartCommand(
                            threadId: threadId,
                            text: trimmed,
                            effort: resolvedEffort(forThread: threadId),
                            fastMode: resolvedFastMode(forThread: threadId)
                        )
                    )
                )
            )
            guard response.receipt?.status != "rejected" else {
                gatewayError = .hostError(code: "command_rejected", message: "Studio could not start this turn.", retryable: false)
                return false
            }
            scheduleSnapshotRefresh()
            return true
        } catch let error as GraftError {
            gatewayError = error
            return false
        } catch {
            gatewayError = .transport(error)
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
            gatewayError = .transport(error)
            return false
        }
    }

    var availableModels: [ModelOption] { models.availableModels }

    func loadModelsIfNeeded(force: Bool = false) async {
        await models.load(force: force) { [self] in
            let response = try await sendCommand(
                ClientCommandEnvelope(command: .modelsList(ModelsListCommand())),
                timeout: .seconds(12)
            )
            try response.receipt?.checkAccepted()
            guard let catalog = response.result?.models else {
                throw GraftError.decoding("Studio did not return its models.")
            }
            return catalog
        }
    }

    /// Per-thread reasoning effort chosen on this phone. Deliberately not sent
    /// to the host until a turn starts — mirroring the desktop, where effort
    /// rides on each turn/start instead of living in the thread record.
    private(set) var threadEfforts: [String: String] = [:]
    private(set) var threadFastModes: [String: Bool] = [:]

    func setThreadEffort(threadId: String, effort: String) {
        guard currentModel(forThread: threadId)?.reasoningEfforts?.contains(effort) == true else { return }
        threadEfforts[threadId] = effort
    }

    /// Provider choices are available only before this chat has activity.
    func lockedProviderId(forThread threadId: String) -> String? {
        guard let thread = snapshot?.threads.first(where: { $0.id == threadId }) else { return nil }
        let hasLocalActivity = activeChat.map {
            $0.threadId == threadId && (!$0.items.isEmpty || $0.isTurnActive || $0.sendTick > 0)
        } ?? false
        // Older hosts omit the flag. Existing chats stay on their provider.
        return thread.providerLocked != false || hasLocalActivity ? thread.providerId : nil
    }

    /// Resolve by provider and model together; unknown models keep their host label.
    func currentModel(forThread threadId: String) -> ModelOption? {
        guard let thread = snapshot?.threads.first(where: { $0.id == threadId }) else {
            return availableModels.first { $0.isDefault == true }
                ?? availableModels.first
        }
        if let threadModelName = thread.modelName {
            if let match = availableModels.first(where: {
                $0.id == threadModelName && $0.providerId == thread.providerId
            }) ?? availableModels.first(where: { thread.providerId == nil && $0.id == threadModelName }) {
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
        let providerModels = availableModels.filter {
            thread.providerId == nil || $0.providerId == thread.providerId
        }
        return providerModels.first { $0.isDefault == true } ?? providerModels.first
    }

    /// Strip wire-format suffixes ("[1m]") the desktop uses internally.
    static func modelDisplayName(_ id: String) -> String {
        id.replacingOccurrences(of: "[1m]", with: "")
    }

    /// Prefer a valid local choice, then Studio's confirmed choice and the
    /// model's advertised default. Unsupported choices never cross providers.
    func resolvedEffort(forThread threadId: String) -> String? {
        guard let model = currentModel(forThread: threadId),
              let efforts = model.reasoningEfforts, !efforts.isEmpty else { return nil }
        let thread = snapshot?.threads.first { $0.id == threadId }
        for candidate in [threadEfforts[threadId], thread?.effort, model.defaultReasoningEffort] {
            if let candidate, efforts.contains(candidate) { return candidate }
        }
        return efforts.contains("high") ? "high" : efforts.first
    }

    func resolvedFastMode(forThread threadId: String) -> Bool? {
        guard currentModel(forThread: threadId)?.supportsFastMode == true else { return nil }
        return threadFastModes[threadId]
            ?? snapshot?.threads.first { $0.id == threadId }?.fastMode
            ?? false
    }

    func setThreadFastMode(threadId: String, enabled: Bool) {
        guard currentModel(forThread: threadId)?.supportsFastMode == true else { return }
        threadFastModes[threadId] = enabled
    }

    /// Point the thread at a different model for subsequent turns. The
    /// confirmed thread updates the control before the next snapshot arrives.
    func setThreadModel(threadId: String, model: ModelOption) async -> Bool {
        if let providerId = lockedProviderId(forThread: threadId), model.providerId != providerId {
            return false
        }
        let oldProvider = currentModel(forThread: threadId)?.providerId
        let confirmed = await models.select(
            model, threadId: threadId, currentProviderId: oldProvider,
            canChangeProvider: canChangeProvider(forThread: threadId)
        ) { [self] in
            let response = try await sendCommand(
                ClientCommandEnvelope(command: .threadSetModel(ThreadSetModelCommand(
                    threadId: threadId, modelId: model.id, providerId: model.providerId
                ))),
                timeout: .seconds(20)
            )
            try response.receipt?.checkAccepted()
            guard let thread = response.result?.thread else {
                throw GraftError.decoding("Studio did not confirm the model change.")
            }
            return thread
        }
        guard let confirmed else {
            // A timeout can leave the command's outcome unknown. Reconcile
            // with Studio; do not automatically repeat a model mutation.
            scheduleSnapshotRefresh(immediately: true)
            return false
        }
        if confirmed.providerId != oldProvider {
            threadEfforts[threadId] = nil
            threadFastModes[threadId] = nil
        }
        snapshotRequestGeneration += 1
        if let previous = snapshot {
            snapshot = EnvironmentSnapshot(
                environment: previous.environment, projects: previous.projects,
                threads: previous.threads.map { $0.id == threadId ? confirmed : $0 },
                activeRuns: previous.activeRuns, pendingApprovals: previous.pendingApprovals,
                pendingQuestions: previous.pendingQuestions,
                selectedTranscript: previous.selectedTranscript, cursor: previous.cursor
            )
        }
        scheduleSnapshotRefresh()
        return true
    }

    func canChangeProvider(forThread threadId: String) -> Bool {
        guard let chat = activeChat, chat.threadId == threadId else { return false }
        return lockedProviderId(forThread: threadId) == nil && chat.canChangeProvider
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
            gatewayError = .transport(error)
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
            gatewayError = .transport(error)
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
            gatewayError = .transport(error)
            return nil
        }
    }

    func fetchComposerCommands(threadId: String) async throws -> [ComposerCommand] {
        let response = try await sendCommand(ClientCommandEnvelope(
            command: .composerCommands(ComposerCommandsCommand(threadId: threadId))
        ))
        guard let commands = response.result?.commands else {
            throw GraftError.decoding("Studio could not load commands. Reopen the / menu to retry.")
        }
        return commands
    }

    func fetchSkillPreview(threadId: String, name: String) async throws -> ComposerSkillPreview {
        let response = try await sendCommand(ClientCommandEnvelope(
            command: .composerSkillRead(ComposerSkillReadCommand(threadId: threadId, name: name))
        ))
        guard let skill = response.result?.skill else {
            throw GraftError.decoding("Studio could not load this skill. Try again.")
        }
        return skill
    }

    func resolveFiles(threadId: String, references: [String]) async throws -> [WorkspaceFileReference] {
        let response = try await sendCommand(ClientCommandEnvelope(
            command: .filesResolve(FilesResolveCommand(threadId: threadId, references: references))
        ))
        guard let references = response.result?.references else {
            throw GraftError.decoding("Studio could not resolve file references.")
        }
        return references
    }

    func readFile(threadId: String, path: String) async throws -> WorkspaceFile {
        let response = try await sendCommand(ClientCommandEnvelope(
            command: .fileRead(FileReadCommand(threadId: threadId, path: path))
        ))
        guard let file = response.result?.file else {
            throw GraftError.decoding("Studio could not open this workspace file.")
        }
        return file
    }

    private func sendCommand(
        _ envelope: ClientCommandEnvelope,
        timeout: Duration? = nil
    ) async throws -> HostResponseEnvelope {
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                commandWaiters[envelope.commandId] = continuation
                if let timeout {
                    commandTimeouts[envelope.commandId] = Task { [weak self] in
                        do { try await Task.sleep(for: timeout) } catch { return }
                        self?.completeCommand(envelope.commandId, result: .failure(
                            GraftError.timeout("Studio did not respond. Check the connection and retry.")
                        ))
                    }
                }
                Task { [weak self] in
                    do {
                        try await self?.gateway.send(envelope)
                    } catch {
                        self?.completeCommand(envelope.commandId, result: .failure(error))
                    }
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                self?.completeCommand(envelope.commandId, result: .failure(CancellationError()))
            }
        }
    }

    private func completeCommand(
        _ id: String,
        result: Result<HostResponseEnvelope, Error>
    ) {
        commandTimeouts.removeValue(forKey: id)?.cancel()
        commandWaiters.removeValue(forKey: id)?.resume(with: result)
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

        gateway.onFailure = { [weak self] error in
            self?.handleConnectionError(error)
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
            activeChat?.finishHistoryLoading()
        default:
            break
        }
    }

    private func handleWelcome(_ data: Data) {
        guard let welcome = try? JSONDecoder().decode(HostWelcome.self, from: data) else { return }
        guard welcome.environmentId == connection.session?.environmentId else {
            gatewayError = .decoding("Welcome belongs to another computer.")
            stop()
            return
        }
        AppLog.networking.info("Gateway welcome from \(welcome.environmentLabel), cursor=\(welcome.cursor)")
        gatewayError = nil
        scheduleSnapshotRefresh(immediately: true)
        Task { [weak self] in await self?.activeChat?.refreshDiff() }
    }

    private func handleSnapshot(_ data: Data) {
        guard let snap = try? JSONDecoder().decode(EnvironmentSnapshot.self, from: data) else { return }
        guard snap.environment.id == connection.session?.environmentId else {
            gatewayError = .decoding("Snapshot belongs to another computer.")
            return
        }
        snapshot = snap
        activeChat?.applySnapshot(snap)
        updateInboxReads()
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
        commandTimeouts.values.forEach { $0.cancel() }
        commandTimeouts.removeAll()
        for waiter in waiters.values {
            waiter.resume(throwing: GraftError.socketClosed)
        }
    }

    private func handleCommandResponse(_ data: Data) {
        guard let response = try? JSONDecoder().decode(HostResponseEnvelope.self, from: data) else {
            scheduleSnapshotRefresh()
            return
        }
        completeCommand(response.commandId, result: .success(response))
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
        updateInboxReads(event: hostEvent.event)
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
        handleConnectionError(.hostError(
            code: detail.code,
            message: detail.message,
            retryable: detail.retryable ?? false
        ))
        AppLog.networking.error("Host error: \(detail.code) — \(detail.message)")
    }

    private func handleConnectionError(_ error: GraftError) {
        gatewayError = error
        if case .hostError(let code, _, _) = error,
           code == "device_revoked" || code == "session_revoked" {
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
            updateInboxReads()
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
        snapshotRequestGeneration += 1
        let generation = snapshotRequestGeneration
        let threadID = selectedThreadId
        defer {
            if generation == snapshotRequestGeneration { activeChat?.finishHistoryLoading() }
        }
        do {
            let refreshed = try await client.snapshot(threadId: threadID)
            guard refreshed.environment.id == connection.session?.environmentId else {
                throw GraftError.decoding("Snapshot belongs to another computer.")
            }
            guard generation == snapshotRequestGeneration, threadID == selectedThreadId else { return }
            snapshot = refreshed
            activeChat?.applySnapshot(refreshed)
            updateInboxReads()
            gatewayError = nil
            persistSnapshot(refreshed)
            AppLog.networking.debug(
                "Refreshed environment snapshot at cursor \(refreshed.cursor)"
            )
        } catch let error as GraftError {
            guard !Task.isCancelled, generation == snapshotRequestGeneration else { return }
            gatewayError = error
            AppLog.networking.warning(
                "Snapshot refresh failed: \(error.localizedDescription)"
            )
        } catch {
            guard !Task.isCancelled, generation == snapshotRequestGeneration else { return }
            gatewayError = .transport(error)
            AppLog.networking.warning(
                "Snapshot refresh failed: \(error.localizedDescription)"
            )
        }
    }

    private func updateInboxReads(event: TimelineEvent? = nil) {
        guard let environmentId = connection.session?.environmentId else { return }
        let key = "inbox.reads.\(environmentId)"
        if inboxReadEnvironmentId != environmentId {
            inboxReadEnvironmentId = environmentId
            inboxReadState = readDefaults.data(forKey: key)
                .flatMap { try? JSONDecoder().decode(InboxReadState.self, from: $0) } ?? InboxReadState()
            inboxPendingAnswers.removeAll()
        }
        var next = inboxReadState
        for thread in snapshot?.threads ?? [] {
            if let timestamp = thread.lastCompletedAt { next.completed(thread.id, at: timestamp) }
        }
        if let event, let id = event.threadId {
            if ["assistant.delta", "assistant.message"].contains(event.kind),
               event.text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
                inboxPendingAnswers[id] = event.runId ?? ""
            }
            if event.kind == "run.status" || event.kind == "error" {
                let matches = event.runId == nil || inboxPendingAnswers[id] == "" || inboxPendingAnswers[id] == event.runId
                if matches {
                    if event.runStatus == "completed", inboxPendingAnswers[id] != nil {
                        next.completed(id, at: event.completedAt ?? event.createdAt)
                    }
                    if event.kind == "error" || ["completed", "failed", "cancelled"].contains(event.runStatus ?? "") {
                        inboxPendingAnswers[id] = nil
                    }
                }
            }
        }
        if let id = InboxReadVisibility.visibleThreadId(
            isForeground: isForeground,
            isConversationCovered: isConversationCovered,
            selectedThreadId: selectedThreadId,
            loadedTranscriptThreadId: snapshot?.selectedTranscript?.threadId
        ) {
            next.viewed(id)
        }
        guard next != inboxReadState else { return }
        inboxReadState = next
        if let data = try? JSONEncoder().encode(next) { readDefaults.set(data, forKey: key) }
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


/// Each paired computer owns its transport, commands, cursor and transcript.
/// Filtering the inbox never swaps the transport underneath an open chat.
@MainActor
@Observable
final class MachineStore {
    let store: LocalStore
    let pairingApp: AppModel
    private(set) var machines: [AppModel] = []
    private(set) var error: String?
    private var isForeground = true

    init(store: LocalStore? = nil) {
        let store = store ?? LocalStore()
        self.store = store
        pairingApp = AppModel(store: store, loadSavedSession: false)
        reload()
    }

    func reload() {
        do {
            let sessions = try store.allSessions()
            let previous = machines
            machines = sessions.map { session in
                if let existing = previous.first(where: {
                    $0.environmentId == session.environmentId && $0.sessionIdentity == session.sessionId
                }) { return existing }
                let machine = AppModel(
                    store: store, environmentId: session.environmentId,
                    settings: pairingApp.settings, auth: pairingApp.auth
                )
                machine.onUnpaired = { [weak self] in self?.reload() }
                return machine
            }
            for old in previous where !machines.contains(where: { $0 === old }) { old.stop() }
            if isForeground { machines.forEach { $0.reconnectIfNeeded() } }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func machine(_ id: String?) -> AppModel? {
        machines.first { $0.environmentId == id }
    }

    func remove(_ machine: AppModel) async {
        await machine.unpair()
        reload()
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        isForeground = phase == .active
        machines.forEach { $0.scenePhaseChanged(phase) }
    }
}

extension AppModel: Identifiable {
    var id: String { environmentId ?? "unpaired" }
    var environmentId: String? { connection.session?.environmentId }
    var environmentLabel: String {
        if let snapshot, snapshot.environment.id == environmentId {
            let label = snapshot.environment.label.trimmingCharacters(in: .whitespacesAndNewlines)
            if !label.isEmpty { return label }
        }
        if let label = connection.session?.environmentLabel.trimmingCharacters(in: .whitespacesAndNewlines),
           !label.isEmpty { return label }
        return "Studio"
    }
}
