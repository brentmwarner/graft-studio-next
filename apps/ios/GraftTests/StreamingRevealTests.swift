import XCTest
@testable import Graft

final class StreamingRevealTests: XCTestCase {
    func testArrivalFadesOnlyAppendedGraphemesWithoutRestartingEarlierFades() {
        var fade = StreamingTextFade(text: "Hello ")
        fade.receive("Hello 👨‍👩‍👧‍👦", at: 1, enabled: true)
        fade.receive("Hello 👨‍👩‍👧‍👦 café", at: 1.05, enabled: true)
        XCTAssertEqual(fade.arrivals, [
            .init(range: 6..<7, time: 1),
            .init(range: 7..<12, time: 1.05),
        ])
        fade.receive("Hello 👨‍👩‍👧‍👦 café!", at: 1.12, enabled: true)
        XCTAssertEqual(fade.arrivals.map(\.time), [1.05, 1.12])
    }

    func testArrivalFadeSettlesOnCorrectionCompletionAndReducedMotion() {
        var fade = StreamingTextFade(text: "History")
        XCTAssertTrue(fade.arrivals.isEmpty)
        fade.receive("History grows", at: 1, enabled: true)
        fade.receive("Corrected", at: 1.01, enabled: true)
        XCTAssertTrue(fade.arrivals.isEmpty)
        fade.receive("Corrected again", at: 1.02, enabled: true)
        fade.receive("Corrected again", at: 1.03, enabled: false)
        XCTAssertTrue(fade.arrivals.isEmpty)
        XCTAssertEqual(fade.text, "Corrected again")
    }

    func testStreamingHapticsAreSpacedAndLimitedToThreePerTurn() {
        var cadence = StreamingHapticCadence()
        let chunk = String(repeating: "a", count: 48)
        XCTAssertFalse(cadence.receive(from: "", to: "a", at: 0, enabled: true))
        XCTAssertTrue(cadence.receive(from: "a", to: chunk, at: 0.1, enabled: true))
        XCTAssertFalse(cadence.receive(from: chunk, to: chunk + chunk, at: 0.2, enabled: true))
        XCTAssertTrue(cadence.receive(from: chunk + chunk, to: chunk + chunk + "a", at: 1.6, enabled: true))
        XCTAssertTrue(cadence.receive(from: "", to: chunk, at: 3.2, enabled: true))
        XCTAssertFalse(cadence.receive(from: "", to: chunk, at: 5, enabled: true))
    }

    func testStreamingHapticsIgnoreDisabledUpdatesCorrectionsAndUnchangedText() {
        var cadence = StreamingHapticCadence()
        let text = String(repeating: "a", count: 80)
        XCTAssertFalse(cadence.receive(from: "", to: text, at: 1, enabled: false))
        XCTAssertFalse(cadence.receive(from: text, to: text, at: 2, enabled: true))
        XCTAssertFalse(cadence.receive(from: text, to: "corrected", at: 3, enabled: true))
        XCTAssertFalse(cadence.receive(from: "corrected", to: "corrected!", at: 4, enabled: true))
    }

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

    func testPartialLinkDestinationDoesNotFlashIntoProse() {
        XCTAssertEqual(StreamingReveal.readableMarkdownTail("Read [the guide](https://example.com/pa"), "Read the guide")
        XCTAssertEqual(StreamingReveal.readableMarkdownTail("Read [the guide](https://example.com)"), "Read [the guide](https://example.com)")
    }

    func testPartialLinkInsideCodeOrEscapedLabelStaysLiteral() {
        for source in ["`[label](https://example.com", "``[label](https://example.com", #"\[label](https://example.com"#] {
            XCTAssertEqual(StreamingReveal.readableMarkdownTail(source), source)
        }
        XCTAssertEqual(StreamingReveal.readableMarkdownTail("`code` then [guide](https://example.com"), "`code` then guide")
    }
}
