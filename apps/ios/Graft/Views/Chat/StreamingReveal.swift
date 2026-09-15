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
}
