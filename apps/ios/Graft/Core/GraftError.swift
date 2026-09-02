import Foundation

/// Domain errors for the Graft iOS app.
enum GraftError: Error, Sendable, Equatable {
    /// No session has been established via pairing.
    case notPaired
    /// The stored bearer token was rejected by the host.
    case unauthorized
    /// A network-level failure (unreachable host, TLS, timeout).
    case unreachable(String)
    /// The WebSocket was closed unexpectedly.
    case socketClosed
    /// The server returned an unexpected HTTP status.
    case http(status: Int, body: String)
    /// JSON could not be encoded or decoded.
    case decoding(String)
    /// Session metadata or credentials could not be persisted locally.
    case persistence(String)
    /// The pairing URL was malformed or missing required fields.
    case malformedPairingURL(String)
    /// The host sent an error envelope.
    case hostError(code: String, message: String, retryable: Bool)
    /// An operation timed out.
    case timeout(String)

    var isRetryable: Bool {
        switch self {
        case .hostError(_, _, let retryable): return retryable
        case .unreachable, .socketClosed, .timeout: return true
        case .notPaired, .unauthorized, .http, .decoding, .persistence, .malformedPairingURL:
            return false
        }
    }
}

extension GraftError: LocalizedError {
    var errorDescription: String? {
        switch self {
        case .notPaired:
            return String(localized: "Not paired with any Studio.")
        case .unauthorized:
            return String(localized: "Authentication failed.")
        case .unreachable(let detail):
            return String(localized: "Unreachable: \(detail)")
        case .socketClosed:
            return String(localized: "Connection closed.")
        case .http(let status, _):
            return String(localized: "HTTP \(status)")
        case .decoding(let detail):
            return String(localized: "Decode error: \(detail)")
        case .persistence(let detail):
            return String(localized: "Storage error: \(detail)")
        case .malformedPairingURL(let detail):
            return String(localized: "Bad pairing URL: \(detail)")
        case .hostError(_, let message, _):
            return message
        case .timeout(let detail):
            return String(localized: "Timeout: \(detail)")
        }
    }
}
