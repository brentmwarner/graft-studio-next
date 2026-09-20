import Foundation

/// Domain errors for the Graft iOS app.
enum GraftError: Error, Sendable, Equatable {
    /// No session has been established via pairing.
    case notPaired
    /// The stored bearer token was rejected by the host.
    case unauthorized
    /// The computer or network cannot currently be reached.
    case unreachable(String)
    /// A transport failure that needs attention, such as rejected TLS credentials.
    case connectionFailed(String)
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

    /// Offline is expected for sleeping computers; protocol/auth failures need attention.
    var isOffline: Bool {
        switch self {
        case .unreachable, .socketClosed, .timeout: true
        case .hostError(let code, _, _): code == "host_offline"
        default: false
        }
    }

    static func transport(_ error: Error) -> GraftError {
        if let error = error as? GraftError { return error }
        if let error = error as? URLError {
            switch error.code {
            case .cannotFindHost, .cannotConnectToHost, .timedOut,
                 .networkConnectionLost, .notConnectedToInternet, .dnsLookupFailed,
                 .internationalRoamingOff, .callIsActive, .dataNotAllowed:
                return .unreachable(error.localizedDescription)
            default:
                return .connectionFailed(error.localizedDescription)
            }
        }
        let underlying = error as NSError
        if underlying.domain == NSPOSIXErrorDomain,
           let code = POSIXError.Code(rawValue: Int32(underlying.code)) {
            switch code {
            case .ECONNREFUSED, .ECONNRESET, .EHOSTDOWN, .EHOSTUNREACH,
                 .ENETDOWN, .ENETRESET, .ENETUNREACH, .ENOTCONN, .EPIPE, .ETIMEDOUT:
                return .unreachable(error.localizedDescription)
            default:
                break
            }
        }
        return .connectionFailed(error.localizedDescription)
    }

    static func httpResponse(status: Int, body: Data) -> GraftError {
        if status == 401 { return .unauthorized }
        if let response = try? JSONDecoder().decode(HTTPFailure.self, from: body) {
            return .hostError(code: response.error.code, message: response.error.message,
                              retryable: response.error.retryable ?? false)
        }
        return .http(status: status, body: String(decoding: body, as: UTF8.self))
    }

    private struct HTTPFailure: Decodable {
        let error: HostErrorDetail
    }

    var isRetryable: Bool {
        switch self {
        case .hostError(_, _, let retryable): return retryable
        case .unreachable, .socketClosed, .timeout: return true
        case .notPaired, .unauthorized, .connectionFailed, .http, .decoding, .persistence, .malformedPairingURL:
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
        case .connectionFailed(let detail):
            return String(localized: "Connection failed: \(detail)")
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
