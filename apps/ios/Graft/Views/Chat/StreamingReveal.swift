import Foundation

/// Provider-independent reveal math shared by the iOS transcript renderer.
/// The gateway sends cumulative snapshots; this turns sparse jumps into the
/// same steady, word-aware stream used by Graft desktop and Android.
enum StreamingReveal {
    static let commitIntervalMilliseconds = 40
    static let maximumAnimatedCharacters = 20_000

    private static let maximumBoundaryLookahead = 40

    static func initialDisplayedLength(in text: String, isStreaming: Bool) -> Int {
        isStreaming && text.utf16.count <= maximumAnimatedCharacters ? 0 : text.utf16.count
    }

    static func advanceToWordBoundary(_ text: String, index: Int) -> Int {
        let units = Array(text.utf16)
        guard index > 0 else { return 0 }
        guard index < units.count else { return units.count }

        if isWhitespace(units[index]) || isWhitespace(units[index - 1]) {
            return safeUTF16Boundary(in: units, index: index)
        }

        let limit = min(units.count, index + maximumBoundaryLookahead)
        if index + 1 < limit {
            for cursor in (index + 1)..<limit where isWhitespace(units[cursor]) {
                return safeUTF16Boundary(in: units, index: cursor)
            }
        }
        return safeUTF16Boundary(in: units, index: limit == units.count ? units.count : index)
    }

    static func nextLength(
        in text: String,
        currentLength: Int,
        elapsedMilliseconds: Double
    ) -> Int {
        let targetLength = text.utf16.count
        guard currentLength < targetLength else { return targetLength }
        let remaining = targetLength - currentLength
        let charactersPerSecond = 170.0 + 4.0 * Double(max(0, remaining - 90))
        let elapsed = min(200.0, max(0, elapsedMilliseconds))
        let step = max(1, min(600, Int((elapsed / 1_000 * charactersPerSecond).rounded())))
        return advanceToWordBoundary(text, index: min(targetLength, currentLength + step))
    }

    static func prefix(_ text: String, utf16Length: Int) -> String {
        let units = Array(text.utf16)
        let length = safeUTF16Boundary(in: units, index: min(max(0, utf16Length), units.count))
        return String(decoding: units.prefix(length), as: UTF16.self)
    }

    private static func isWhitespace(_ unit: UInt16) -> Bool {
        guard let scalar = UnicodeScalar(unit) else { return false }
        return CharacterSet.whitespacesAndNewlines.contains(scalar)
    }

    private static func safeUTF16Boundary(in units: [UInt16], index: Int) -> Int {
        guard index > 0, index < units.count else { return min(max(0, index), units.count) }
        let previousIsHighSurrogate = (0xD800...0xDBFF).contains(units[index - 1])
        let nextIsLowSurrogate = (0xDC00...0xDFFF).contains(units[index])
        return previousIsHighSurrogate && nextIsLowSurrogate ? index + 1 : index
    }
}
