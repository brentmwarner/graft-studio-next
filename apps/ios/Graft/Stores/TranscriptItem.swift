import Foundation
import UIKit

enum ToolRunStatus: Equatable {
    case running
    case done
    case failed
}

/// One entry in a chat transcript. A class (not a struct) so streaming delta
/// appends invalidate only the row that displays this item — the surrounding
/// list depends on the array of references, which only changes on insert.
@MainActor
@Observable
final class TranscriptItem: Identifiable {
    enum Kind: Equatable {
        case user
        case assistant
        case tool
        case agents
        case system
        case error
    }

    let id = UUID()
    let kind: Kind
    var sourceID: String?

    var text = "" { didSet { cachedNormalizedMergeText = nil; refreshDerivedFlags() } }
    var reasoning = "" { didSet { refreshDerivedFlags() } }
    /// Images attached to this row: agent screenshots/tool images, user
    /// composer attachments, or markdown/path refs in prose.
    var images: [ChatImage] = []
    /// Playable clips referenced in this row's prose (agent media paths).
    var videos: [ChatVideo] = []
    /// Web links in assistant prose surfaced as preview cards below the text.
    var linkPreviews: [LinkPreviewLoader] = []
    var isStreaming = false { didSet { refreshDerivedFlags() } }
    var reasoningStartedAt: Date?
    var reasoningDuration: Double?

    // Tool-call fields
    var toolID = ""
    var toolName = ""
    var toolContext = ""
    var toolSummary = ""
    var toolResultText = ""
    var toolDuration: Double?
    var toolStatus: ToolRunStatus = .done

    // Delegation fields (`kind == .agents`): one sub-conversation card per
    // spawned child agent. `agentsSettled` flips when the delegate tool call
    // returns — late events can no longer mutate this block.
    var agentRuns: [AgentRun] = []
    var agentsSettled = false
    private(set) var isSessionNotice = false
    private(set) var isActivityTimelineItem = false
    /// True when this row's prose is large enough that rendering it through the
    /// full markdown engine on the main thread would risk a hang. Computed once
    /// per text change (see `refreshDerivedFlags`) so the view never pays an
    /// O(n) size check during layout.
    private(set) var isOversized = false
    /// True once `attachRichContent` has run for this item. The link/media
    /// regex passes are the expensive part of opening a long thread, so history
    /// items attach lazily: a recent visible window is eager-attached at load
    /// and older rows attach as they scroll into view. This flag makes repeated
    /// appearances a single bool check instead of re-running the regex.
    /// Set only by `ChatModel.attachRichContent`.
    var richContentAttached = false

    /// Above this UTF-8 size a row renders as a cheap plain-text preview instead
    /// of going through `AttributedString(markdown:)` + the glyph renderer. A
    /// multi-KB/MB message (e.g. a background-job log dump) parsed and laid out
    /// synchronously as the force-realized tail row on thread open is what froze
    /// the transcript and got the app watchdog-killed. Bytes (O(1) to read), not
    /// characters, so CJK (≈3 bytes/char) trips it sooner — matching its higher
    /// layout cost.
    static let inlineRenderByteLimit = 16_000

    /// Hard ceiling on how much of an oversized message the "show full message"
    /// sheet renders, so even an already-persisted multi-MB row can't stall when
    /// the user opens it.
    static let maxRenderedChars = 80_000

    init(kind: Kind) {
        self.kind = kind
        refreshDerivedFlags()
    }

    static func user(_ text: String) -> TranscriptItem {
        let item = TranscriptItem(kind: .user)
        item.text = text
        return item
    }

    static func assistant(_ text: String = "", streaming: Bool = false) -> TranscriptItem {
        let item = TranscriptItem(kind: .assistant)
        item.text = text
        item.isStreaming = streaming
        return item
    }

    static func system(_ text: String) -> TranscriptItem {
        let item = TranscriptItem(kind: .system)
        item.text = text.strippedStatusFace
        return item
    }

    static func error(_ text: String) -> TranscriptItem {
        let item = TranscriptItem(kind: .error)
        item.text = text.strippedStatusFace
        return item
    }

    static func tool(id: String, name: String, context: String, status: ToolRunStatus = .running) -> TranscriptItem {
        let item = TranscriptItem(kind: .tool)
        item.toolID = id
        item.toolName = name
        item.toolContext = context
        item.toolStatus = status
        return item
    }

    static func agents(runs: [AgentRun] = []) -> TranscriptItem {
        let item = TranscriptItem(kind: .agents)
        item.agentRuns = runs
        return item
    }

    private func refreshDerivedFlags() {
        let nextActivity = kind == .tool || (kind == .assistant && text.isEmpty && !reasoning.isEmpty)
        if isActivityTimelineItem != nextActivity {
            isActivityTimelineItem = nextActivity
        }

        let nextNotice = Self.looksLikeSessionNotice(kind: kind, text: text, isStreaming: isStreaming)
        if isSessionNotice != nextNotice {
            isSessionNotice = nextNotice
        }

        let nextOversized = text.utf8.count > Self.inlineRenderByteLimit
        if isOversized != nextOversized {
            isOversized = nextOversized
        }
    }

    /// Hermes opens each new chat with config/notice lines that aren't real
    /// replies: the "◆ Model: … / ◆ Context: …" session banner, and one-off
    /// "ℹ …" lifecycle notices (e.g. the Codex context-cap auto-compaction
    /// note). Cache the answer instead of recomputing from every row's text
    /// during transcript layout.
    private static func looksLikeSessionNotice(kind: Kind, text: String, isStreaming: Bool) -> Bool {
        guard kind == .assistant else { return false }
        guard !isStreaming else { return false }
        return isSessionNoticeText(text)
    }

    /// Text-only notice predicate for callers holding persisted rows (settled
    /// by definition — apply only to assistant rows). Shared with `LocalStore`
    /// so notices are excluded from inbox previews the same way they're
    /// excluded from the transcript.
    static func isSessionNoticeText(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.contains("◆ Model:") && trimmed.contains("◆ Context:") { return true }
        // Lifecycle/config notices lead with the ℹ glyph (U+2139, optionally
        // with a trailing variation selector). Match the leading scalar so a
        // trailing U+FE0F doesn't defeat the check.
        if trimmed.unicodeScalars.first?.value == 0x2139 { return true }
        return false
    }

    // MARK: Identity-preserving reconcile

    private var cachedNormalizedMergeText: String?

    /// Merge-comparison spelling of `text`: media refs scrubbed and whitespace
    /// collapsed. The live bubble is scrubbed at `message.complete` while
    /// history rows arrive raw — without normalizing, the same reply carries
    /// two different keys and the merge appends a duplicate bubble.
    var normalizedMergeText: String {
        if let cached = cachedNormalizedMergeText { return cached }
        let normalized = Self.normalizeForMerge(text)
        cachedNormalizedMergeText = normalized
        return normalized
    }

    static func normalizeForMerge(_ text: String) -> String {
        // Bound the regex passes: a multi-KB log-dump row only ever matches on
        // its lead, and an unbounded scrub of it on the main thread is exactly
        // the freeze `inlineRenderByteLimit` exists to prevent.
        let bounded = text.utf8.count > inlineRenderByteLimit
            ? String(text.prefix(inlineRenderByteLimit))
            : text
        return MediaRefScrubber.scrub(bounded)
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }

    /// Stable key for matching a freshly-itemized row to an existing one during a
    /// reconcile, so the surviving object (and its identity) is reused instead of
    /// replaced. Text rows key on leading prose — a streamed partial still
    /// matches its settled twin; tool rows prefer the gateway id, else
    /// name+context; agents key on their goal set.
    var mergeKey: String {
        if let sourceID { return sourceID }
        switch kind {
        case .user, .assistant, .system, .error:
            return "\(kind):\(normalizedMergeText.prefix(64))"
        case .tool:
            return toolID.isEmpty
                ? "tool:\(toolName):\(toolContext.prefix(64))"
                : "tool:#\(toolID)"
        case .agents:
            return "agents:\(agentRuns.map { $0.goal.prefix(40) }.joined(separator: "|"))"
        }
    }

    /// Copy the displayable content of a freshly-itemized row into this surviving
    /// object, so a reconcile updates it in place and the row keeps its identity
    /// (and its realized SwiftUI subtree). Live-stream scratch state
    /// (`reasoningStartedAt`, `isStreaming`) is deliberately left untouched.
    func absorb(_ other: TranscriptItem) {
        sourceID = other.sourceID
        isStreaming = other.isStreaming
        // Equivalent prose in a different spelling (a raw history row whose
        // media refs the live bubble already scrubbed) keeps the displayed
        // text; a material change adopts the server's and re-arms the lazy
        // rich-content pass so the new prose scrubs/attaches on appear.
        if normalizedMergeText != other.normalizedMergeText || text.isEmpty {
            text = other.text
            richContentAttached = false
        }
        reasoning = other.reasoning
        if !other.images.isEmpty { images = other.images }
        if !other.videos.isEmpty { videos = other.videos }
        if !other.linkPreviews.isEmpty { linkPreviews = other.linkPreviews }
        toolID = other.toolID
        toolName = other.toolName
        toolContext = other.toolContext
        toolSummary = other.toolSummary
        toolResultText = other.toolResultText
        toolDuration = other.toolDuration
        toolStatus = other.toolStatus
        if !other.agentRuns.isEmpty { agentRuns = other.agentRuns }
        agentsSettled = other.agentsSettled
        reasoningDuration = other.reasoningDuration
    }
}

/// An image queued in the composer, sent via `image.attach_bytes` right
/// before the next `prompt.submit`.
struct PendingAttachment: Identifiable, Equatable {
    let id = UUID()
    let jpegData: Data
    let thumbnail: UIImage
}

struct ApprovalRequest: Equatable {
    /// Gateway approval id, target of `approval.resolve`.
    var approvalID: String
    var command: String
    var description: String

    init(payload: JSONValue) {
        approvalID = payload["approval_id"].string ?? ""
        command = payload["command"].string ?? ""
        description = payload["description"].string ?? ""
    }

    init(approval: PendingApproval) {
        approvalID = approval.id
        command = approval.title
        description = approval.detail ?? ""
    }

    init(approvalID: String, command: String, description: String) {
        self.approvalID = approvalID
        self.command = command
        self.description = description
    }
}

struct ClarifyRequest: Equatable {
    var requestID: String
    var question: String
    var choices: [String]
    /// Gateway option ids aligned with `choices`; empty when the host sent
    /// freeform-only. `question.resolve` prefers the id when one matches.
    var choiceIDs: [String]

    init(payload: JSONValue) {
        requestID = payload["request_id"].string ?? ""
        question = payload["question"].string ?? ""
        choices = (payload["choices"].array ?? []).compactMap(\.string)
        choiceIDs = []
    }

    init(question pending: PendingQuestion) {
        requestID = pending.id
        question = pending.prompt
        choices = (pending.options ?? []).map(\.label)
        choiceIDs = (pending.options ?? []).map(\.id)
    }

    init(requestID: String, question: String, choices: [String] = [], choiceIDs: [String] = []) {
        self.requestID = requestID
        self.question = question
        self.choices = choices
        self.choiceIDs = choiceIDs
    }
}

struct SecretRequest: Equatable {
    var requestID: String
    var prompt: String
    var envVar: String

    init(payload: JSONValue) {
        requestID = payload["request_id"].string ?? ""
        prompt = payload["prompt"].string ?? ""
        envVar = payload["env_var"].string ?? ""
    }
}
