import Foundation

/// Coalesces provider snapshots without imposing a separate typing speed.
/// Every commit displays the entire received snapshot, including Unicode text.
struct StreamingReveal {
    static let commitIntervalMilliseconds = 32

    private(set) var displayedText: String
    private(set) var targetText: String

    init(text: String) {
        displayedText = text
        targetText = text
    }

    mutating func receive(_ text: String, isStreaming: Bool, reduceMotion: Bool) {
        targetText = text
        if !isStreaming || reduceMotion || !text.hasPrefix(displayedText) {
            displayedText = text
        }
    }

    @discardableResult
    mutating func commit() -> Bool {
        guard displayedText != targetText else { return false }
        displayedText = targetText
        return true
    }

    /// Until a link destination closes, show its label without flashing a raw
    /// URL into the paragraph. Keep code examples and final source untouched.
    static func readableMarkdownTail(_ text: String) -> String {
        guard let range = text.range(of: #"(?<!\\)\[([^\]\n]+)\]\([^\)\n]*$"#, options: .regularExpression),
              let labelEnd = text[range].range(of: "](") else { return text }
        let prefix = text[..<range.lowerBound]
        var codeDelimiter: Int?
        var cursor = prefix.startIndex
        while cursor < prefix.endIndex {
            if prefix[cursor] == "`" {
                let end = prefix[cursor...].firstIndex(where: { $0 != "`" }) ?? prefix.endIndex
                let length = prefix.distance(from: cursor, to: end)
                if codeDelimiter == length { codeDelimiter = nil }
                else if codeDelimiter == nil { codeDelimiter = length }
                cursor = end
            } else {
                cursor = prefix.index(after: cursor)
            }
        }
        guard codeDelimiter == nil else { return text }
        return String(prefix) + text[text.index(after: range.lowerBound)..<labelEnd.lowerBound]
    }
}
