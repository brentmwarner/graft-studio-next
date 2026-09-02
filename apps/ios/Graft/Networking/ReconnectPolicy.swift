import Foundation

/// Exponential backoff with full jitter for WebSocket reconnect attempts.
///
/// Delay formula: `min(maxDelay, base * 2^attempt) * random(0.5...1.5)`
/// First attempt: ~500ms. Subsequent attempts double up to `maxDelay` (30s).
struct ReconnectPolicy: Sendable {
    var baseDelay: Duration
    var maxDelay: Duration
    var jitterFactor: Double

    static let `default` = ReconnectPolicy(
        baseDelay: .milliseconds(500),
        maxDelay: .seconds(30),
        jitterFactor: 0.5
    )

    /// Returns the delay for the given zero-indexed attempt number.
    func delay(for attempt: Int) -> Duration {
        let base = baseDelay.components
        let baseSeconds = Double(base.seconds) + Double(base.attoseconds) / 1e18
        let rawSeconds = min(
            Double(maxDelay.components.seconds),
            baseSeconds * pow(2.0, Double(attempt))
        )
        let jitter = rawSeconds * Double.random(in: (1.0 - jitterFactor)...(1.0 + jitterFactor))
        let clamped = min(jitter, Double(maxDelay.components.seconds))
        return .milliseconds(Int(clamped * 1000))
    }
}
