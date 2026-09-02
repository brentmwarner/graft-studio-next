import XCTest
@testable import Graft

/// Tests for `ReconnectPolicy` exponential backoff + jitter.
final class ReconnectPolicyTests: XCTestCase {

    private let policy = ReconnectPolicy.default

    // MARK: Delay range

    func testFirstAttemptIsInExpectedRange() {
        // Attempt 0: base=0.5s ±50% → 250ms … 750ms
        let delay = policy.delay(for: 0)
        let ms = delayMilliseconds(delay)
        XCTAssertGreaterThanOrEqual(ms, 250)
        XCTAssertLessThanOrEqual(ms, 750)
    }

    func testSecondAttemptIsInExpectedRange() {
        // Attempt 1: base=1s ±50% → 500ms … 1500ms
        let delay = policy.delay(for: 1)
        let ms = delayMilliseconds(delay)
        XCTAssertGreaterThanOrEqual(ms, 500)
        XCTAssertLessThanOrEqual(ms, 1500)
    }

    func testThirdAttemptIsInExpectedRange() {
        // Attempt 2: base=2s ±50% → 1000ms … 3000ms
        let delay = policy.delay(for: 2)
        let ms = delayMilliseconds(delay)
        XCTAssertGreaterThanOrEqual(ms, 1000)
        XCTAssertLessThanOrEqual(ms, 3000)
    }

    func testDelayNeverExceedsMaxDelay() {
        for attempt in 0..<20 {
            let delay = policy.delay(for: attempt)
            let ms = delayMilliseconds(delay)
            // max 30s + 50% jitter upper bound = 45s; but our formula clamps
            // to max BEFORE jitter, so the jitter is applied to max at most
            let absoluteMax = 30_000 * Int((1.0 + policy.jitterFactor))
            XCTAssertLessThanOrEqual(ms, absoluteMax,
                "Attempt \(attempt) produced \(ms)ms which exceeds maximum")
        }
    }

    func testAttempt10IsCapped() {
        // At attempt 10, base = min(30, 0.5 * 2^10) = min(30, 512) = 30s
        let delay = policy.delay(for: 10)
        let ms = delayMilliseconds(delay)
        // Must be ≤ 30s + jitter
        XCTAssertLessThanOrEqual(ms, 45_000)
        // Must be ≥ 30s - jitter
        XCTAssertGreaterThanOrEqual(ms, 15_000)
    }

    func testDelayGrowsWithAttemptCount() {
        // Sample 20 runs: the median delay at attempt 5 should exceed
        // the median delay at attempt 0 by a large margin.
        var samples0: [Int] = []
        var samples5: [Int] = []
        for _ in 0..<20 {
            samples0.append(delayMilliseconds(policy.delay(for: 0)))
            samples5.append(delayMilliseconds(policy.delay(for: 5)))
        }
        let avg0 = samples0.reduce(0, +) / samples0.count
        let avg5 = samples5.reduce(0, +) / samples5.count
        XCTAssertGreaterThan(avg5, avg0 * 5, "Expected delay at attempt 5 >> attempt 0")
    }

    func testCustomPolicyRespectsCap() {
        let custom = ReconnectPolicy(
            baseDelay: .milliseconds(100),
            maxDelay: .seconds(2),
            jitterFactor: 0.0  // no jitter for determinism
        )
        // With jitter=0, delay for attempt 100 should equal maxDelay exactly.
        let delay = custom.delay(for: 100)
        let ms = delayMilliseconds(delay)
        XCTAssertEqual(ms, 2000)
    }

    // MARK: Helpers

    private func delayMilliseconds(_ duration: Duration) -> Int {
        let components = duration.components
        return Int(components.seconds * 1000) + Int(components.attoseconds / 1_000_000_000_000_000)
    }
}
