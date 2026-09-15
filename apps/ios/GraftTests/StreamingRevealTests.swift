import XCTest
@testable import Graft

final class StreamingRevealTests: XCTestCase {
    func testMountPreservesReceivedText() {
        let stream = StreamingReveal(text: "Already received 😀")
        XCTAssertEqual(stream.displayedText, "Already received 😀")
    }

    func testCommitDrainsAnEntireLargeSnapshot() {
        var stream = StreamingReveal(text: "Start")
        let target = "Start " + String(repeating: "received text 😀 ", count: 500)
        stream.receive(target, isStreaming: true, reduceMotion: false)
        XCTAssertEqual(stream.displayedText, "Start")
        XCTAssertTrue(stream.commit())
        XCTAssertEqual(stream.displayedText, target)
        XCTAssertFalse(stream.commit())
    }

    func testCoalescesToTheLatestSnapshot() {
        var stream = StreamingReveal(text: "A")
        stream.receive("A B", isStreaming: true, reduceMotion: false)
        stream.receive("A B C", isStreaming: true, reduceMotion: false)
        stream.commit()
        XCTAssertEqual(stream.displayedText, "A B C")
    }

    func testCompletionFlushesImmediately() {
        var stream = StreamingReveal(text: "A")
        stream.receive("A B", isStreaming: true, reduceMotion: false)
        stream.receive("A B C", isStreaming: false, reduceMotion: false)
        XCTAssertEqual(stream.displayedText, "A B C")
        XCTAssertFalse(stream.commit())
    }

    func testCorrectionReplacesThePendingTail() {
        var stream = StreamingReveal(text: "Original")
        stream.receive("Original pending", isStreaming: true, reduceMotion: false)
        stream.receive("Corrected", isStreaming: true, reduceMotion: false)
        XCTAssertEqual(stream.displayedText, "Corrected")
        XCTAssertFalse(stream.commit())
    }

    func testReducedMotionFlushesImmediately() {
        var stream = StreamingReveal(text: "A")
        stream.receive("A B C", isStreaming: true, reduceMotion: true)
        XCTAssertEqual(stream.displayedText, "A B C")
        XCTAssertFalse(stream.commit())
    }
}
