import Foundation

/// The live working line's copy. Starts as "Thinking", then tracks the
/// current tool so the header can swap to "Running a command" without a
/// ticking clock.
enum LiveStatusPhrase {
    static let thinking = "Thinking"

    static func current(
        runningToolName: String?,
        context: String = "",
        fallback: String? = nil
    ) -> String {
        if let name = runningToolName?.trimmingCharacters(in: .whitespacesAndNewlines),
           !name.isEmpty {
            return ToolPresentation(name: name, context: context).runningPhrase
        }
        if let fallback = fallback?.trimmingCharacters(in: .whitespacesAndNewlines),
           !fallback.isEmpty {
            return fallback
        }
        return thinking
    }

    @MainActor
    static func current(from items: [TranscriptItem], fallback: String? = nil) -> String {
        let scoped: ArraySlice<TranscriptItem>
        if let lastUser = items.lastIndex(where: { $0.kind == .user }) {
            scoped = items[(lastUser + 1)...]
        } else {
            scoped = items[...]
        }
        guard let running = scoped.last(where: { $0.kind == .tool && $0.toolStatus == .running }) else {
            return current(runningToolName: nil, fallback: fallback)
        }
        return current(runningToolName: running.toolName, context: running.toolContext)
    }
}
