import Foundation
import UIKit

/// Manages session lifecycle: pairing, bearer-token persistence, and
/// the resolved `RESTClient` / WebSocket request used by `AppModel`.
///
/// Session data (URLs, IDs) lives in SwiftData via `LocalStore`.
/// The bearer token lives exclusively in Keychain.
@MainActor
@Observable
final class ConnectionStore {
    private let store: LocalStore

    /// The active session, loaded from SwiftData on startup.
    private(set) var session: PersistedSession?

    /// Indicates a pairing operation is in progress.
    private(set) var isPairing = false

    /// The last pairing error, if any.
    private(set) var pairingError: GraftError?

    var isPaired: Bool { session != nil }

    init(store: LocalStore, environmentId: String? = nil, loadSavedSession: Bool = true) {
        self.store = store
        if loadSavedSession { loadSession(environmentId: environmentId) }
    }

    // MARK: Session access

    /// Returns a `RESTClient` configured for the active session, or `nil` if unpaired.
    var restClient: RESTClient? {
        guard let session, let url = URL(string: session.httpBaseUrl) else { return nil }
        guard let token = Keychain.string(for: session.keychainAccount), !token.isEmpty else {
            return nil
        }
        return RESTClient(baseURL: url, bearerToken: token)
    }

    /// Returns an authenticated WebSocket upgrade request for the active session.
    /// The bearer token is carried in the HTTP header and never placed in the URL.
    func webSocketRequest() throws -> URLRequest {
        guard let session else { throw GraftError.notPaired }
        guard let token = Keychain.string(for: session.keychainAccount), !token.isEmpty else {
            throw GraftError.unauthorized
        }
        return try AuthenticatedWebSocketRequest.make(
            baseURL: session.wsBaseUrl,
            sessionId: session.sessionId,
            bearerToken: token
        )
    }

    // MARK: Pairing

    /// Processes a decoded `PairingPayload` (from URL scheme or QR code).
    /// Posts a `PairRequest` to the host and persists the resulting session.
    func pair(with payload: PairingPayload) async {
        guard !isPairing else { return }
        isPairing = true
        pairingError = nil
        defer { isPairing = false }

        guard let hostURL = URL(string: payload.host) else {
            pairingError = .malformedPairingURL("Invalid host URL: \(payload.host)")
            return
        }

        let bootstrapClient = RESTClient(baseURL: hostURL, bearerToken: "")
        do {
            let deviceLabel = UIDevice.current.name
            let response = try await bootstrapClient.pair(
                token: payload.token,
                deviceLabel: deviceLabel,
                deviceId: DeviceIdentity.current
            )
            guard response.ok, let pairSession = response.session else {
                pairingError = .unauthorized
                return
            }
            try persistSession(pairSession)
        } catch let e as GraftError {
            pairingError = e
        } catch {
            pairingError = .transport(error)
        }
    }

    /// Clears the active session (bearer token + SwiftData row).
    @discardableResult
    func unpair() async -> Bool {
        guard let session else { return true }
        let sessionId = session.sessionId
        let environmentId = session.environmentId
        PushRegistrar.shared.configure(connectionStore: self)
        await PushRegistrar.shared.unregisterForCurrentSession()
        do {
            // A re-pair may replace this row while push unregistration awaits.
            guard try store.session(environmentId: environmentId)?.sessionId == sessionId else {
                self.session = nil
                return true
            }
            try store.deleteSession(environmentId: environmentId)
            Keychain.delete(for: session.keychainAccount)
            self.session = nil
            pairingError = nil
            AppLog.pairing.info("Session cleared for environment \(session.environmentId)")
            return true
        } catch {
            pairingError = .persistence("Could not remove the paired session.")
            AppLog.persistence.error("Failed to remove paired session metadata: \(error)")
            return false
        }
    }

    // MARK: Private

    private func loadSession(environmentId: String?) {
        do {
            if let environmentId {
                session = try store.session(environmentId: environmentId)
            } else {
                session = try store.allSessions().first
            }
        } catch {
            AppLog.persistence.error("Failed to load sessions: \(error)")
        }
    }

    private func persistSession(_ pair: PairSession) throws {
        let account = "bearerToken:\(pair.environmentId)"
        let previousToken = Keychain.string(for: account)
        guard Keychain.set(pair.bearerToken, for: account) else {
            throw GraftError.persistence("Could not store the session credential securely.")
        }

        let persisted = PersistedSession(
            environmentId:   pair.environmentId,
            environmentLabel: pair.environmentLabel,
            httpBaseUrl:     pair.httpBaseUrl,
            wsBaseUrl:       pair.wsBaseUrl,
            sessionId:       pair.sessionId,
            deviceId:        pair.deviceId,
            keychainAccount: account,
            protocolVersion: pair.protocolVersion,
            capabilities:    pair.capabilities,
            endpointKind:    pair.endpointKind
        )
        do {
            try store.upsertSession(persisted)
        } catch {
            if !Keychain.set(previousToken, for: account) {
                AppLog.persistence.error("Failed to restore the previous session credential")
            }
            throw error
        }
        session = persisted
        AppLog.pairing.info("Paired with environment \(pair.environmentId) (\(pair.environmentLabel))")
    }
}

enum AuthenticatedWebSocketRequest {
    static func make(baseURL: String, sessionId: String, bearerToken: String) throws -> URLRequest {
        guard !bearerToken.isEmpty else { throw GraftError.unauthorized }
        guard var components = URLComponents(string: baseURL) else {
            throw GraftError.decoding("Invalid WebSocket base URL")
        }

        // Pairing returns a WebSocket base URL. The desktop upgrade handler
        // owns `/v1/ws`, so resolve that route here before adding session
        // metadata. Accepting an already-resolved route keeps persisted
        // sessions forward-compatible without ever duplicating the path.
        var basePath = components.path
        while basePath.count > 1, basePath.hasSuffix("/") {
            basePath.removeLast()
        }
        if !basePath.hasSuffix("/v1/ws") {
            components.path = (basePath == "/" ? "" : basePath) + "/v1/ws"
        } else {
            components.path = basePath
        }

        var queryItems = components.queryItems ?? []
        queryItems.removeAll { $0.name == "sessionId" || $0.name == "token" }
        queryItems.append(URLQueryItem(name: "sessionId", value: sessionId))
        components.queryItems = queryItems

        guard let url = components.url else {
            throw GraftError.decoding("Cannot construct WebSocket URL")
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        return request
    }
}
