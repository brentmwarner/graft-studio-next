import Foundation

/// Lifecycle of one delegated child agent. `queued` is a placeholder built
/// from the delegate call's arguments before the child actually starts
/// (fan-outs beyond the concurrency cap sit here until a slot frees up).
enum AgentRunStatus: Equatable {
    case queued
    case working
    case done
    case failed
}

/// One line of a child agent's live feed — a thinking fragment or a tool
/// invocation, newest last.
struct AgentActivity: Identifiable, Equatable {
    enum Kind: Equatable {
        case thinking
        case tool
    }

    let id = UUID()
    let kind: Kind
    let text: String
}

/// A tool result from the child's transcript tail, delivered on completion.
/// Powers the detail sheet's "Activity" section.
struct AgentTailEntry: Identifiable, Equatable {
    let id = UUID()
    let tool: String
    let preview: String
    let isError: Bool
}

/// The face a child agent wears in chat: a human role name derived from what
/// it was sent to do, plus the monogram and symbol that brand its card.
struct AgentPersona: Equatable {
    let name: String
    let symbol: String

    var monogram: String { String(name.prefix(1)) }

    /// Toolsets are the strongest signal (they say what the agent CAN do), so
    /// every toolkit rule is tried before any goal-keyword rule — "build a
    /// packing list" with a files/write kit is a Writer, not an Engineer.
    init(toolsets: [String], goal: String, taskIndex: Int) {
        let kit = toolsets.joined(separator: " ").lowercased()
        let brief = goal.lowercased()

        func kitHas(_ words: String...) -> Bool {
            words.contains { kit.contains($0) }
        }
        func briefHas(_ words: String...) -> Bool {
            words.contains { brief.contains($0) }
        }

        if kitHas("web", "search", "browser") {
            (name, symbol) = ("Researcher", "magnifyingglass")
        } else if kitHas("terminal", "code", "exec", "shell", "git") {
            (name, symbol) = ("Engineer", "chevron.left.forwardslash.chevron.right")
        } else if kitHas("vision", "image", "screenshot", "computer") {
            (name, symbol) = ("Vision", "eye")
        } else if kitHas("file", "docs", "write") {
            (name, symbol) = ("Writer", "square.and.pencil")
        } else if kitHas("voice", "audio", "speech") {
            (name, symbol) = ("Voice", "waveform")
        } else if kitHas("cron", "schedule") {
            (name, symbol) = ("Scheduler", "clock")
        } else if briefHas("research", "find ", "look up", "search", "compare") {
            (name, symbol) = ("Researcher", "magnifyingglass")
        } else if briefHas("implement", "fix ", "refactor", "debug", "code") {
            (name, symbol) = ("Engineer", "chevron.left.forwardslash.chevron.right")
        } else if briefHas("write ", "draft", "summarize", "document", "list") {
            (name, symbol) = ("Writer", "square.and.pencil")
        } else if briefHas("screenshot", "look at the screen") {
            (name, symbol) = ("Vision", "eye")
        } else if briefHas("schedule", "remind") {
            (name, symbol) = ("Scheduler", "clock")
        } else {
            (name, symbol) = ("Agent \(taskIndex + 1)", "sparkle")
        }
    }
}

/// One delegated sub-agent conversation. A class (mirroring `TranscriptItem`)
/// so live event appends invalidate only the card rendering this run.
@MainActor
@Observable
final class AgentRun: Identifiable {
    /// Stable view identity: the placeholder key (`task-<n>`) when the run
    /// was pre-created from the call's arguments, else the server id.
    let id: String
    /// The live server `subagent_id` once the child starts — the handle
    /// `subagent.interrupt` wants. Nil for queued placeholders and history.
    var subagentID: String?
    let goal: String
    let taskIndex: Int
    /// 0 for direct children; ≥1 when a child orchestrator spawned this run.
    let depth: Int
    private(set) var persona: AgentPersona

    var model = ""
    var toolsets: [String] = []
    var status: AgentRunStatus = .working
    /// Live feed while working — capped so a long run can't grow unbounded.
    private(set) var activity: [AgentActivity] = []
    var toolCount = 0

    // Completion report
    var summary = ""
    var durationSeconds: Double?
    var inputTokens: Int?
    var outputTokens: Int?
    var apiCalls: Int?
    var costUSD: Double?
    var filesRead: [String] = []
    var filesWritten: [String] = []
    var outputTail: [AgentTailEntry] = []

    /// Wired by `ChatModel` to the `subagent.interrupt` RPC; nil for settled
    /// runs and gallery samples (the detail sheet hides Stop).
    var onInterrupt: (() -> Void)?

    init(id: String, goal: String, taskIndex: Int = 0, depth: Int = 0, toolsets: [String] = []) {
        self.id = id
        self.goal = goal
        self.taskIndex = taskIndex
        self.depth = depth
        self.toolsets = toolsets
        self.persona = AgentPersona(toolsets: toolsets, goal: goal, taskIndex: taskIndex)
    }

    private static let activityCap = 60

    /// The child started for real: bind the live id, refine the persona with
    /// the actual toolkit, and leave the queue. Idempotent.
    func activate(subagentID: String?, model: String?, toolsets: [String]) {
        if let subagentID, !subagentID.isEmpty {
            self.subagentID = subagentID
        }
        if let model, !model.isEmpty {
            self.model = model
        }
        if !toolsets.isEmpty, self.toolsets != toolsets {
            self.toolsets = toolsets
            persona = AgentPersona(toolsets: toolsets, goal: goal, taskIndex: taskIndex)
        }
        if status == .queued {
            status = .working
        }
    }

    /// First line of the reply, markdown stripped — the workline's settled
    /// one-liner (rendered as plain text, so `**` would read as noise).
    var resultPreview: String {
        guard let first = summary
            .split(separator: "\n", omittingEmptySubsequences: true)
            .first.map({ String($0).trimmingCharacters(in: .whitespaces) })
        else { return "" }
        guard let attributed = try? AttributedString(
            markdown: first,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) else { return first }
        return String(attributed.characters)
    }

    func noteThinking(_ text: String) {
        let line = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !line.isEmpty, line != activity.last?.text else { return }
        append(AgentActivity(kind: .thinking, text: line))
    }

    func noteTool(name: String, preview: String) {
        let presentation = ToolPresentation(name: name, context: preview)
        let detail = preview.trimmingCharacters(in: .whitespacesAndNewlines)
        // "Searching the web" reads better than a raw tool name; append the
        // preview when it adds something human (a query, a command) — but not
        // when the phrase already names the destination ("Reading nytimes.com")
        // and never raw JSON.
        let line: String
        if presentation.domain == nil, !detail.isEmpty, !detail.hasPrefix("{") {
            line = "\(presentation.runningPhrase) · \(detail)"
        } else {
            line = presentation.runningPhrase
        }
        guard line != activity.last?.text else { return }
        append(AgentActivity(kind: .tool, text: line))
    }

    private func append(_ entry: AgentActivity) {
        activity.append(entry)
        if activity.count > Self.activityCap {
            activity.removeFirst(activity.count - Self.activityCap)
        }
    }

    /// Fold the `subagent.complete` payload into a settled report.
    func complete(payload: JSONValue) {
        status = (payload["status"].string ?? "completed") == "completed" ? .done : .failed
        if let text = payload["summary"].string, !text.isEmpty {
            summary = text
        }
        durationSeconds = payload["duration_seconds"].double
        inputTokens = payload["input_tokens"].int
        outputTokens = payload["output_tokens"].int
        apiCalls = payload["api_calls"].int
        costUSD = payload["cost_usd"].double
        if let model = payload["model"].string, !model.isEmpty {
            self.model = model
        }
        filesRead = (payload["files_read"].array ?? []).compactMap(\.string)
        filesWritten = (payload["files_written"].array ?? []).compactMap(\.string)
        outputTail = (payload["output_tail"].array ?? []).map {
            AgentTailEntry(
                tool: $0["tool"].string ?? "tool",
                preview: $0["preview"].string ?? "",
                isError: $0["is_error"].bool ?? false
            )
        }
    }

    /// Fold a stored `delegate_task` result entry — the history shape
    /// (`{"results": [entry, …]}`), not the live event one — into this run.
    func applyHistory(entry: JSONValue) {
        status = (entry["status"].string ?? "completed") == "completed" ? .done : .failed
        summary = entry["summary"].string ?? ""
        durationSeconds = entry["duration_seconds"].double
        apiCalls = entry["api_calls"].int
        inputTokens = entry["tokens"]["input"].int
        outputTokens = entry["tokens"]["output"].int
        if let model = entry["model"].string { self.model = model }
    }

    /// A settled run rebuilt from a stored `delegate_task` result entry.
    static func fromHistory(entry: JSONValue, goal: String) -> AgentRun {
        let index = entry["task_index"].int ?? 0
        let run = AgentRun(id: "history-task-\(index)", goal: goal, taskIndex: index)
        run.applyHistory(entry: entry)
        return run
    }
}
