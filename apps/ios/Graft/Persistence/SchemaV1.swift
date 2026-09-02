import Foundation
import SwiftData

// MARK: - Schema V1

/// SwiftData model for persisting a paired host session.
///
/// One row per environment. If the user re-pairs to the same environment,
/// the existing row is updated rather than duplicated.
@Model
final class PersistedSession {
    @Attribute(.unique) var environmentId: String
    var environmentLabel: String
    var httpBaseUrl: String
    var wsBaseUrl: String
    var sessionId: String
    var deviceId: String
    /// Bearer token is stored in Keychain, not here.
    /// This field records the Keychain account key (`bearerToken:<environmentId>`).
    var keychainAccount: String
    var protocolVersion: Int
    var capabilities: [String]
    var pairedAt: Date
    /// Transport this session was issued over (`relay`, `tailnet`, `lan`, …).
    /// Optional so sessions paired before the managed relay still load.
    var endpointKind: String?

    init(
        environmentId: String,
        environmentLabel: String,
        httpBaseUrl: String,
        wsBaseUrl: String,
        sessionId: String,
        deviceId: String,
        keychainAccount: String,
        protocolVersion: Int,
        capabilities: [String],
        pairedAt: Date = .now,
        endpointKind: String? = nil
    ) {
        self.environmentId = environmentId
        self.environmentLabel = environmentLabel
        self.httpBaseUrl = httpBaseUrl
        self.wsBaseUrl = wsBaseUrl
        self.sessionId = sessionId
        self.deviceId = deviceId
        self.keychainAccount = keychainAccount
        self.protocolVersion = protocolVersion
        self.capabilities = capabilities
        self.pairedAt = pairedAt
        self.endpointKind = endpointKind
    }
}

/// SwiftData model for caching the last-known environment snapshot.
@Model
final class CachedEnvironmentSnapshot {
    @Attribute(.unique) var environmentId: String
    var rawJSON: Data
    var cachedAt: Date

    init(environmentId: String, rawJSON: Data, cachedAt: Date = .now) {
        self.environmentId = environmentId
        self.rawJSON = rawJSON
        self.cachedAt = cachedAt
    }
}

/// SwiftData model for caching one thread's last-known transcript
/// (`TranscriptContainer` JSON), so reopening a conversation paints instantly
/// from disk while the authoritative snapshot round-trips to the host.
@Model
final class CachedThreadTranscript {
    @Attribute(.unique) var threadId: String
    var environmentId: String
    var rawJSON: Data
    var cachedAt: Date

    init(threadId: String, environmentId: String, rawJSON: Data, cachedAt: Date = .now) {
        self.threadId = threadId
        self.environmentId = environmentId
        self.rawJSON = rawJSON
        self.cachedAt = cachedAt
    }
}
