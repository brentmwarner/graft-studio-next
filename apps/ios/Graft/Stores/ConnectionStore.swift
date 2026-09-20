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

    /// Every stored pairing, newest last-used first.
    private(set) var sessions: [PersistedSession] = []

    /// Indicates a pairing operation is in progress.
    private(set) var isPairing = false

    /// The last pairing error, if any.
    private(set) var pairingError: GraftError?

    var isPaired: Bool { session != nil }

    private let defaults: UserDefaults
    private static let activeEnvironmentKey = "connection.activeEnvironmentId"

    init(store: LocalStore, defaults: UserDefaults = .standard) {
        self.store = store
        self.defaults = defaults
        loadSession()
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
            pairingError = .unreachable(error.localizedDescription)
        }
    }

    /// Clears one stored pairing. Omitting `environmentId` disconnects the
    /// active computer and, if others remain, activates the next one.
    @discardableResult
    func unpair(_ environmentId: String? = nil) async -> Bool {
        guard let targetId = environmentId ?? session?.environmentId else { return true }
        let removingCurrent = session?.environmentId == targetId
        if removingCurrent {
            PushRegistrar.shared.configure(connectionStore: self)
            await PushRegistrar.shared.unregisterForCurrentSession()
        }
        do {
            let account = try store.session(environmentId: targetId)?.keychainAccount
                ?? session?.keychainAccount
            try store.deleteSession(environmentId: targetId)
            if let account { Keychain.delete(for: account) }
            if defaults.string(forKey: Self.activeEnvironmentKey) == targetId {
                defaults.removeObject(forKey: Self.activeEnvironmentKey)
            }
            refreshSessions()
            if removingCurrent {
                session = sessions.first
                if let session {
                    rememberActiveEnvironment(session.environmentId)
                }
            }
            pairingError = nil
            AppLog.pairing.info("Session cleared for environment \(targetId)")
            return true
        } catch {
            pairingError = .persistence("Could not remove the paired session.")
            AppLog.persistence.error("Failed to remove paired session metadata: \(error)")
            return false
        }
    }

    func activate(environmentId: String) {
        guard environmentId != session?.environmentId else { return }
        do {
            guard let next = try store.session(environmentId: environmentId) else { return }
            session = next
            rememberActiveEnvironment(environmentId)
            refreshSessions()
            pairingError = nil
            AppLog.pairing.info("Activated environment \(environmentId)")
        } catch {
            pairingError = .persistence("Could not switch to that computer.")
            AppLog.persistence.error("Failed to activate session \(environmentId): \(error)")
        }
    }

    // MARK: Private

    private func loadSession() {
        refreshSessions()
        if let remembered = defaults.string(forKey: Self.activeEnvironmentKey),
           let match = sessions.first(where: { $0.environmentId == remembered }) {
            session = match
        } else {
            session = sessions.first
        }
        if let session {
            rememberActiveEnvironment(session.environmentId)
        }
    }

    private func refreshSessions() {
        do {
            sessions = try store.allSessions()
        } catch {
            AppLog.persistence.error("Failed to load sessions: \(error)")
            sessions = []
        }
    }

    private func rememberActiveEnvironment(_ environmentId: String) {
        defaults.set(environmentId, forKey: Self.activeEnvironmentKey)
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
        rememberActiveEnvironment(pair.environmentId)
        refreshSessions()
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
