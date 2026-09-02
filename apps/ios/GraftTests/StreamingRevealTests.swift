import XCTest
@testable import Graft

final class StreamingRevealTests: XCTestCase {
    func testRevealLandsOnWordBoundary() {
        let text = "Hello streaming world"
        let length = StreamingReveal.advanceToWordBoundary(text, index: 8)
        XCTAssertEqual(length, 15)
        XCTAssertEqual(StreamingReveal.prefix(text, utf16Length: length), "Hello streaming")
    }

    func testRevealFinishesShortUnbrokenTail() {
        XCTAssertEqual(StreamingReveal.advanceToWordBoundary("hello", index: 2), 5)
    }

    func testRevealHardCutsPathologicalTokenAfterBoundedLookahead() {
        XCTAssertEqual(
            StreamingReveal.advanceToWordBoundary(String(repeating: "x", count: 100), index: 10),
            10
        )
    }

    func testSparseSnapshotBacklogAcceleratesReveal() {
        let text = String(repeating: "word ", count: 100) + "done"
        let quietStep = StreamingReveal.nextLength(
            in: String(text.prefix(80)),
            currentLength: 0,
            elapsedMilliseconds: 40
        )
        let backlogStep = StreamingReveal.nextLength(
            in: text,
            currentLength: 0,
            elapsedMilliseconds: 40
        )
        XCTAssertGreaterThan(backlogStep, quietStep)
    }

    func testRevealNeverAdvancesBeyondTarget() {
        XCTAssertEqual(
            StreamingReveal.nextLength(in: "Done", currentLength: 3, elapsedMilliseconds: 200),
            4
        )
        XCTAssertEqual(
            StreamingReveal.nextLength(in: "Done", currentLength: 4, elapsedMilliseconds: 200),
            4
        )
    }

    func testActiveStreamStartsEmptyUntilTheRevealLoopRuns() {
        XCTAssertEqual(
            StreamingReveal.initialDisplayedLength(in: "First provider snapshot", isStreaming: true),
            0
        )
        XCTAssertEqual(
            StreamingReveal.initialDisplayedLength(in: "Settled", isStreaming: false),
            7
        )
        XCTAssertEqual(
            StreamingReveal.initialDisplayedLength(
                in: String(repeating: "x", count: 20_001),
                isStreaming: true
            ),
            20_001
        )
    }

    func testPrefixNeverSplitsEmojiSurrogatePair() {
        XCTAssertEqual(StreamingReveal.prefix("A😀B", utf16Length: 2), "A😀")
    }
}
