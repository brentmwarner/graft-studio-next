import Foundation

// MARK: - Pairing

/// Decoded from `graft://pair?v=1&host=<url>#token=<tok>` or from the
/// JSON payload delivered via QR code / clipboard.
struct PairingPayload: Codable, Sendable, Equatable {
    let v: Int
    let host: String
    let token: String
    let label: String?
    let endpointKind: String?
}

struct PairClientInfo: Codable, Sendable {
    let platform: String
    let appVersion: String
    let deviceLabel: String
    /// Stable Keychain-backed identity so the host replaces this device's
    /// previous registration on re-pair instead of adding a duplicate.
    let deviceId: String
}

struct PairRequest: Codable, Sendable {
    let token: String
    let protocolVersion: Int
    let client: PairClientInfo
}

struct PairSession: Codable, Sendable {
    let sessionId: String
    let deviceId: String
    let bearerToken: String
    let environmentId: String
    let environmentLabel: String
    let httpBaseUrl: String
    let wsBaseUrl: String
    let protocolVersion: Int
    let capabilities: [String]
    let expiresAt: Int?
    /// Transport the host issued this session over. Absent on hosts that
    /// predate the managed relay.
    let endpointKind: String?
}

struct PairResponse: Codable, Sendable {
    let ok: Bool
    let session: PairSession?
}

// MARK: - Push registration scaffold

enum APNsEnvironment: String, Codable, Sendable {
    case sandbox
    case production
}

struct PushRegistrationRequest: Codable, Sendable {
    let apnsToken: String
    let apnsEnvironment: APNsEnvironment
    let bundleId: String
}

struct PushRegistrationMetadata: Codable, Sendable {
    let deviceId: String
    let apnsEnvironment: APNsEnvironment
    let bundleId: String
    let createdAt: Int
    let updatedAt: Int
}

struct PushRegistrationResponse: Codable, Sendable {
    let ok: Bool
    let registration: PushRegistrationMetadata
}

struct PushUnregistrationResponse: Codable, Sendable {
    let ok: Bool
    let removed: Bool
}

// MARK: - Health

struct HealthResponse: Codable, Sendable {
    let ok: Bool
    let service: String
    let protocolVersion: Int
    let capabilities: [String]
    let environmentId: String
    let environmentLabel: String
    let networkAccessEnabled: Bool
    let cursor: Int?
}

// MARK: - WebSocket Envelopes (Client → Host)

/// The discriminated `envelope` field present on every frame.
enum ClientEnvelopeKind: String, Codable, Sendable {
    case hello
    case ping
    case subscribe
    case command
}

enum HostEnvelopeKind: String, Codable, Sendable {
    case welcome
    case pong
    case event
    case response
    case error
    case snapshotRequired = "snapshot_required"
}

// MARK: Client frames

struct ClientHello: Codable, Sendable {
    let envelope: String
    let protocolVersion: Int
    let sessionId: String?
    let afterCursor: Int?
    let capabilities: [String]

    init(sessionId: String?, afterCursor: Int?) {
        envelope = "hello"
        protocolVersion = GraftProtocol.version
        self.sessionId = sessionId
        self.afterCursor = afterCursor
        capabilities = GraftProtocol.clientCapabilities
    }
}

struct ClientPing: Codable, Sendable {
    let envelope: String
    let at: Int

    init(at: Int = Int(Date().timeIntervalSince1970)) {
        envelope = "ping"
        self.at = at
    }
}

struct ClientSubscribe: Codable, Sendable {
    let envelope: String
    let topics: [String]
    let afterCursor: Int?

    init(topics: [String], afterCursor: Int?) {
        envelope = "subscribe"
        self.topics = topics
        self.afterCursor = afterCursor
    }
}

struct ClientCommandEnvelope: Codable, Sendable {
    let envelope: String
    let commandId: String
    let requestId: String?
    let command: CommandPayload

    init(commandId: String = UUID().uuidString, requestId: String? = nil, command: CommandPayload) {
        envelope = "command"
        self.commandId = commandId
        self.requestId = requestId
        self.command = command
    }
}

// MARK: Command payloads

enum CommandPayload: Codable, Sendable {
    case turnStart(TurnStartCommand)
    case turnCancel(TurnCancelCommand)
    case approvalResolve(ApprovalResolveCommand)
    case questionResolve(QuestionResolveCommand)
    case diffGet(DiffGetCommand)
    case cursorReplay(CursorReplayCommand)
    case threadCreate(ThreadCreateCommand)
    case threadSetModel(ThreadSetModelCommand)
    case threadSetApproval(ThreadSetApprovalCommand)
    case modelsList(ModelsListCommand)
    case composerCommands(ComposerCommandsCommand)
    case composerSkillRead(ComposerSkillReadCommand)
    case filesResolve(FilesResolveCommand)
    case fileRead(FileReadCommand)

    private enum CodingKeys: String, CodingKey { case type }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "turn.start":
            self = .turnStart(try TurnStartCommand(from: decoder))
        case "turn.cancel":
            self = .turnCancel(try TurnCancelCommand(from: decoder))
        case "approval.resolve":
            self = .approvalResolve(try ApprovalResolveCommand(from: decoder))
        case "question.resolve":
            self = .questionResolve(try QuestionResolveCommand(from: decoder))
        case "diff.get":
            self = .diffGet(try DiffGetCommand(from: decoder))
        case "cursor.replay":
            self = .cursorReplay(try CursorReplayCommand(from: decoder))
        case "thread.create":
            self = .threadCreate(try ThreadCreateCommand(from: decoder))
        case "thread.set_model":
            self = .threadSetModel(try ThreadSetModelCommand(from: decoder))
        case "thread.set_approval":
            self = .threadSetApproval(try ThreadSetApprovalCommand(from: decoder))
        case "models.list":
            self = .modelsList(try ModelsListCommand(from: decoder))
        case "composer.commands":
            self = .composerCommands(try ComposerCommandsCommand(from: decoder))
        case "composer.skill.read":
            self = .composerSkillRead(try ComposerSkillReadCommand(from: decoder))
        case "files.resolve":
            self = .filesResolve(try FilesResolveCommand(from: decoder))
        case "file.read":
            self = .fileRead(try FileReadCommand(from: decoder))
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: container,
                debugDescription: "Unknown command type: \(type)"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case .turnStart(let cmd):    try cmd.encode(to: encoder)
        case .turnCancel(let cmd):   try cmd.encode(to: encoder)
        case .approvalResolve(let cmd): try cmd.encode(to: encoder)
        case .questionResolve(let cmd): try cmd.encode(to: encoder)
        case .diffGet(let cmd):      try cmd.encode(to: encoder)
        case .cursorReplay(let cmd): try cmd.encode(to: encoder)
        case .threadCreate(let cmd): try cmd.encode(to: encoder)
        case .threadSetModel(let cmd): try cmd.encode(to: encoder)
        case .threadSetApproval(let cmd): try cmd.encode(to: encoder)
        case .modelsList(let cmd): try cmd.encode(to: encoder)
        case .composerCommands(let cmd): try cmd.encode(to: encoder)
        case .composerSkillRead(let cmd): try cmd.encode(to: encoder)
        case .filesResolve(let cmd): try cmd.encode(to: encoder)
        case .fileRead(let cmd): try cmd.encode(to: encoder)
        }
    }
}

struct FilesResolveCommand: Codable, Sendable {
    var type = "files.resolve"
    let threadId: String
    let references: [String]
}

struct FileReadCommand: Codable, Sendable {
    var type = "file.read"
    let threadId: String
    let path: String
}

struct WorkspaceFileReference: Codable, Sendable, Equatable {
    let reference: String
    let path: String?
}

struct WorkspaceFile: Codable, Sendable, Equatable {
    let path: String
    let contents: String
    let truncated: Bool
}

struct ThreadSetModelCommand: Codable, Sendable {
    let type: String
    let threadId: String
    let modelId: String
    let providerId: String?

    init(threadId: String, modelId: String, providerId: String? = nil) {
        type = "thread.set_model"
        self.threadId = threadId
        self.modelId = modelId
        self.providerId = providerId
    }
}

struct ThreadSetApprovalCommand: Codable, Sendable {
    let type: String
    let threadId: String
    let approvalPolicy: String

    init(threadId: String, approvalPolicy: String) {
        type = "thread.set_approval"
        self.threadId = threadId
        self.approvalPolicy = approvalPolicy
    }
}

struct ModelsListCommand: Codable, Sendable {
    let type: String

    init() {
        type = "models.list"
    }
}

struct ComposerCommandsCommand: Codable, Sendable {
    var type = "composer.commands"
    let threadId: String
}

struct ComposerCommand: Codable, Sendable, Equatable, Identifiable {
    var id: String { name }
    let name: String
    let description: String
    let kind: String
    var displayName: String? = nil

    var skillLabel: String {
        displayName ?? name.components(separatedBy: CharacterSet(charactersIn: "-_"))
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
    }
}

struct ComposerSkillReadCommand: Codable, Sendable {
    var type = "composer.skill.read"
    let threadId: String
    let name: String
}

struct ComposerSkillPreview: Codable, Sendable {
    let name: String
    let description: String
    let contents: String
    let truncated: Bool
}

struct ThreadCreateCommand: Codable, Sendable {
    let type: String
    let projectId: String
    let title: String?
    let mode: String?
    let modelId: String?
    let providerId: String?
    let approvalPolicy: String?

    init(
        projectId: String,
        title: String? = nil,
        mode: String? = nil,
        modelId: String? = nil,
        providerId: String? = nil,
        approvalPolicy: String? = nil
    ) {
        type = "thread.create"
        self.projectId = projectId
        self.title = title
        self.mode = mode
        self.modelId = modelId
        self.providerId = providerId
        self.approvalPolicy = approvalPolicy
    }
}

struct TurnStartCommand: Codable, Sendable {
    let type: String
    let threadId: String
    let text: String
    /// Reasoning effort for this turn; the host default applies when nil.
    let effort: String?

    let fastMode: Bool?

    init(threadId: String, text: String, effort: String? = nil, fastMode: Bool? = nil) {
        type = "turn.start"
        self.threadId = threadId
        self.text = text
        self.effort = effort
        self.fastMode = fastMode
    }
}

struct TurnCancelCommand: Codable, Sendable {
    let type: String
    let runId: String

    init(runId: String) {
        type = "turn.cancel"
        self.runId = runId
    }
}

struct QuestionResolveCommand: Codable, Sendable {
    let type: String
    let questionId: String
    let optionId: String?
    let text: String?

    init(questionId: String, optionId: String? = nil, text: String? = nil) {
        type = "question.resolve"
        self.questionId = questionId
        self.optionId = optionId
        self.text = text
    }
}

struct ApprovalResolveCommand: Codable, Sendable {
    let type: String
    let approvalId: String
    let decision: String

    init(approvalId: String, decision: String) {
        type = "approval.resolve"
        self.approvalId = approvalId
        self.decision = decision
    }
}

struct DiffGetCommand: Codable, Sendable {
    let type: String
    let diffId: String
    let filePath: String?

    init(diffId: String, filePath: String? = nil) {
        type = "diff.get"
        self.diffId = diffId
        self.filePath = filePath
    }
}

struct CursorReplayCommand: Codable, Sendable {
    let type: String
    let afterCursor: Int

    init(afterCursor: Int) {
        type = "cursor.replay"
        self.afterCursor = afterCursor
    }
}

// MARK: Host frames

struct HostWelcome: Codable, Sendable {
    let envelope: String
    let protocolVersion: Int
    let capabilities: [String]
    let environmentId: String
    let environmentLabel: String
    let cursor: Int
}

struct HostPong: Codable, Sendable {
    let envelope: String
    let at: Int
}

struct HostError: Codable, Sendable {
    let envelope: String
    let error: HostErrorDetail
}

struct HostErrorDetail: Codable, Sendable {
    let code: String
    let message: String
    let retryable: Bool?
}

struct HostSnapshotRequired: Codable, Sendable {
    let envelope: String
    let reason: String
    let message: String?
}

struct HostEventEnvelope: Codable, Sendable {
    let envelope: String
    let event: TimelineEvent
}

struct HostResponseEnvelope: Codable, Sendable {
    let envelope: String
    let commandId: String
    let requestId: String?
    let receipt: CommandReceipt?
    let result: CommandResult?
}

// MARK: - Timeline Events

struct TimelineAttachment: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let type: String
    let name: String
    let mimeType: String
    let sizeBytes: Int
}

struct MessageSkill: Codable, Sendable, Equatable {
    let name: String
    var displayName: String? = nil

    var command: ComposerCommand {
        ComposerCommand(name: name, description: "", kind: "skill", displayName: displayName)
    }
}

struct TimelineEvent: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let cursor: Int
    let kind: String
    let threadId: String?
    let runId: String?
    let createdAt: Int

    // Optional fields present on specific event kinds
    let text: String?
    let toolName: String?
    let approvalId: String?
    let questionId: String?
    let diffId: String?
    let runStatus: String?
    var attachments: [TimelineAttachment]? = nil
    var data: TimelineTaskData? = nil
    var completedAt: Int? = nil
    var toolId: String? = nil
    var skills: [MessageSkill]? = nil

    var toolIdentity: String {
        guard let toolId else { return id }
        return "\(runId ?? ""):\(toolId)"
    }
}

// MARK: - Command Receipt

struct CommandReceipt: Codable, Sendable {
    let commandId: String
    let status: String
    let runId: String?
    let cursor: Int?
    var errorCode: String? = nil
    var message: String? = nil

    func checkAccepted() throws {
        guard status != "rejected" else {
            throw GraftError.hostError(
                code: errorCode ?? "command_rejected",
                message: message ?? "Studio could not apply this change.",
                retryable: false
            )
        }
    }
}

// MARK: - Command Result

struct CommandResult: Codable, Sendable {
    let type: String
    let run: RunInfo?
    let diff: DiffSummary?
    let thread: ThreadInfo?
    let models: [ModelOption]?
    var commands: [ComposerCommand]? = nil
    var skill: ComposerSkillPreview? = nil
    var references: [WorkspaceFileReference]? = nil
    var file: WorkspaceFile? = nil
}

struct RunInfo: Codable, Sendable {
    let id: String
    let threadId: String
    let status: String
    let startedAt: Int
}

// MARK: - Environment Snapshot

struct EnvironmentSnapshot: Codable, Sendable, Equatable {
    let environment: EnvironmentInfo
    let projects: [ProjectInfo]
    let threads: [ThreadInfo]
    let activeRuns: [ActiveRun]
    let pendingApprovals: [PendingApproval]
    let pendingQuestions: [PendingQuestion]
    let selectedTranscript: TranscriptContainer?
    let cursor: Int
}

struct EnvironmentInfo: Codable, Sendable, Equatable {
    let id: String
    let label: String
    let hostVersion: String?
    let protocolVersion: Int
    let capabilities: [String]
    let cursor: Int
}

struct ProjectInfo: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let name: String
    let kind: String
    let path: String?
    let updatedAt: Int?

    init(
        id: String,
        name: String,
        kind: String,
        path: String? = nil,
        updatedAt: Int? = nil
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.path = path
        self.updatedAt = updatedAt
    }
}

struct ThreadInfo: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let projectId: String
    let title: String
    let updatedAt: Int
    let status: String?
    let preview: String?
    let modelName: String?
    let providerId: String?
    let providerLocked: Bool?
    let mode: String?
    /// Current approval policy, resolved by the host for the thread's provider.
    let approvalPolicy: String?
    /// Policies the permissions menu can offer for this thread's provider.
    let approvalPolicyOptions: [ApprovalPolicyOption]?
    /// The PR this thread tracks, when the host knows its GitHub state.
    let pr: ThreadPrInfo?
    /// Latest context-window occupancy resolved by the host.
    let contextUsage: ContextUsageInfo?
    var effort: String? = nil
    var fastMode: Bool? = nil

    init(
        id: String,
        projectId: String,
        title: String,
        updatedAt: Int,
        status: String? = nil,
        preview: String? = nil,
        modelName: String? = nil,
        providerId: String? = nil,
        providerLocked: Bool? = nil,
        mode: String? = nil,
        approvalPolicy: String? = nil,
        approvalPolicyOptions: [ApprovalPolicyOption]? = nil,
        pr: ThreadPrInfo? = nil,
        contextUsage: ContextUsageInfo? = nil
    ) {
        self.id = id
        self.projectId = projectId
        self.title = title
        self.updatedAt = updatedAt
        self.status = status
        self.preview = preview
        self.modelName = modelName
        self.providerId = providerId
        self.providerLocked = providerLocked
        self.mode = mode
        self.approvalPolicy = approvalPolicy
        self.approvalPolicyOptions = approvalPolicyOptions
        self.pr = pr
        self.contextUsage = contextUsage
    }
}

struct ThreadUsageInfo: Codable, Sendable {
    let threadId: String
    let contextUsage: ContextUsageInfo?
    let allowance: ProviderAllowanceInfo
}

struct ProviderAllowanceInfo: Codable, Sendable {
    struct Limit: Codable, Sendable {
        let label: String
        let remainingPercent: Double
        let resetsAt: String?
    }
    let providerId: String
    let status: String
    let updatedAt: String?
    let stale: Bool
    let planName: String?
    let limits: [Limit]
}

struct ContextUsageInfo: Codable, Sendable, Equatable {
    let percent: Int
    let tokensUsed: Int
    let tokensMax: Int
    let source: String
}

/// GitHub lifecycle of a tracked pull request, mirroring the host's enum.
enum ThreadPrState: String, Codable, Sendable {
    case open
    case draft
    case changesRequested = "changes_requested"
    case merged
    case closed
}

/// The PR a thread tracks. Unknown future states decode as `.open` so one new
/// host-side value can't invalidate the whole snapshot.
struct ThreadPrInfo: Codable, Sendable, Equatable, Hashable {
    let number: Int
    let state: ThreadPrState
    let url: String?

    init(number: Int, state: ThreadPrState, url: String? = nil) {
        self.number = number
        self.state = state
        self.url = url
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        number = try container.decode(Int.self, forKey: .number)
        let rawState = try container.decode(String.self, forKey: .state)
        state = ThreadPrState(rawValue: rawState) ?? .open
        url = try container.decodeIfPresent(String.self, forKey: .url)
    }
}

/// One selectable approval policy for a thread's provider.
struct ApprovalPolicyOption: Codable, Sendable, Equatable, Identifiable, Hashable {
    let value: String
    let label: String
    let description: String?

    var id: String { value }

    init(value: String, label: String, description: String? = nil) {
        self.value = value
        self.label = label
        self.description = description
    }
}

/// A model the host can run turns with, offered by the desktop's registry.
struct ModelOption: Codable, Sendable, Equatable, Identifiable, Hashable {
    let id: String
    let label: String
    let providerId: String
    let providerLabel: String?
    let isDefault: Bool?
    /// Selectable reasoning efforts in display order; nil when the model has
    /// no separate effort choice.
    let reasoningEfforts: [String]?
    let approvalPolicyOptions: [ApprovalPolicyOption]?
    let defaultApprovalPolicy: String?

    var defaultReasoningEffort: String? = nil
    var supportsFastMode: Bool? = nil

    var selectionID: String {
        "\(providerId):\(id)"
    }
}

struct ActiveRun: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let threadId: String
    let projectId: String?
    let status: String
    let startedAt: Int
    let endedAt: Int?
    let title: String?

    init(
        id: String,
        threadId: String,
        projectId: String? = nil,
        status: String,
        startedAt: Int,
        endedAt: Int? = nil,
        title: String? = nil
    ) {
        self.id = id
        self.threadId = threadId
        self.projectId = projectId
        self.status = status
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.title = title
    }
}

struct PendingApproval: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let threadId: String
    let runId: String?
    let title: String
    let detail: String?
    let toolName: String?
    let createdAt: Int

    init(
        id: String,
        threadId: String,
        runId: String? = nil,
        title: String,
        detail: String? = nil,
        toolName: String? = nil,
        createdAt: Int
    ) {
        self.id = id
        self.threadId = threadId
        self.runId = runId
        self.title = title
        self.detail = detail
        self.toolName = toolName
        self.createdAt = createdAt
    }
}

struct PendingQuestion: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let threadId: String
    let runId: String?
    let prompt: String
    let options: [QuestionOption]?
    let allowFreeform: Bool?
    let createdAt: Int
}

struct QuestionOption: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let label: String
}

struct TranscriptContainer: Codable, Sendable, Equatable {
    let threadId: String
    let cursor: Int
    let events: [TimelineEvent]
}

// MARK: - Cursor Replay

struct CursorReplayPayload: Codable, Sendable {
    let afterCursor: Int
    let latestCursor: Int
    let events: [TimelineEvent]
}

// MARK: - Diff Summary

struct DiffSummary: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let threadId: String
    let runId: String?
    let title: String?
    let files: [DiffFile]
    let updatedAt: Int
}

struct DiffFile: Codable, Sendable, Equatable, Identifiable {
    let path: String
    let status: String
    let additions: Int?
    let deletions: Int?

    let previousPath: String?
    let hunks: [DiffHunk]?
    let detailStatus: String?

    var id: String { path }
}

struct DiffHunk: Codable, Sendable, Equatable {
    let oldStart: Int
    let newStart: Int
    let collapsedBefore: Int
    let lines: [DiffLine]
}

struct DiffLine: Codable, Sendable, Equatable {
    let kind: String
    let text: String
    let oldLine: Int?
    let newLine: Int?
    let tokens: [DiffToken]?
}

struct DiffToken: Codable, Sendable, Equatable {
    let text: String
    let lightColor: String?
    let darkColor: String?
    let changed: Bool?
}

// MARK: - Protocol Constants

enum GraftProtocol {
    static let version = 1
    static let clientCapabilities: [String] = [
        "projects",
        "threads",
        "transcript",
        "runs",
        "approvals",
        "diffs",
        "cursor_replay",
        "models",
    ]
}
