import Foundation
import SwiftData

/// Facade over the SwiftData `ModelContainer` that owns the on-device replica.
///
/// All writes must happen on the `@MainActor` because `ModelContext` is not
/// Sendable. Background work should use a detached `ModelContext` if needed.
@MainActor
final class LocalStore {
    let container: ModelContainer

    init(inMemory: Bool = false) {
        let schema = Schema([
            PersistedSession.self,
            CachedEnvironmentSnapshot.self,
            CachedThreadTranscript.self,
        ])
        let config = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: inMemory
        )
        do {
            container = try ModelContainer(for: schema, configurations: config)
        } catch {
            AppLog.persistence.error("Failed to create ModelContainer: \(error)")
            // Fallback to in-memory to avoid crashing in case of schema migration issues.
            let fallbackConfig = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
            container = try! ModelContainer(for: schema, configurations: fallbackConfig)
        }
    }

    private var context: ModelContext { container.mainContext }

    // MARK: Sessions

    func allSessions() throws -> [PersistedSession] {
        let descriptor = FetchDescriptor<PersistedSession>(
            sortBy: [SortDescriptor(\.pairedAt, order: .reverse)]
        )
        return try context.fetch(descriptor)
    }

    func session(environmentId: String) throws -> PersistedSession? {
        var descriptor = FetchDescriptor<PersistedSession>(
            predicate: #Predicate { $0.environmentId == environmentId }
        )
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }

    func upsertSession(_ session: PersistedSession) throws {
        if let existing = try self.session(environmentId: session.environmentId) {
            existing.environmentLabel  = session.environmentLabel
            existing.httpBaseUrl       = session.httpBaseUrl
            existing.wsBaseUrl         = session.wsBaseUrl
            existing.sessionId         = session.sessionId
            existing.deviceId          = session.deviceId
            existing.keychainAccount   = session.keychainAccount
            existing.protocolVersion   = session.protocolVersion
            existing.capabilities      = session.capabilities
            existing.pairedAt          = session.pairedAt
            existing.endpointKind      = session.endpointKind
        } else {
            context.insert(session)
        }
        try context.save()
    }

    func deleteSession(environmentId: String) throws {
        if let existing = try session(environmentId: environmentId) {
            context.delete(existing)
            try context.save()
        }
    }

    // MARK: Cached snapshots

    func cachedSnapshot(environmentId: String) throws -> CachedEnvironmentSnapshot? {
        var descriptor = FetchDescriptor<CachedEnvironmentSnapshot>(
            predicate: #Predicate { $0.environmentId == environmentId }
        )
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }

    func decodedSnapshot(environmentId: String) throws -> EnvironmentSnapshot? {
        guard let cached = try cachedSnapshot(environmentId: environmentId) else {
            return nil
        }
        do {
            return try JSONDecoder().decode(EnvironmentSnapshot.self, from: cached.rawJSON)
        } catch {
            AppLog.persistence.warning(
                "Ignoring invalid cached snapshot for \(environmentId): \(error)"
            )
            return nil
        }
    }

    func saveSnapshot(environmentId: String, rawJSON: Data) throws {
        if let existing = try cachedSnapshot(environmentId: environmentId) {
            existing.rawJSON   = rawJSON
            existing.cachedAt  = .now
        } else {
            context.insert(CachedEnvironmentSnapshot(environmentId: environmentId, rawJSON: rawJSON))
        }
        try context.save()
    }

    // MARK: Cached transcripts

    /// Threads kept in the transcript cache; least-recently written beyond
    /// this are pruned on save.
    private static let transcriptCacheLimit = 50

    func decodedTranscript(threadId: String) throws -> TranscriptContainer? {
        var descriptor = FetchDescriptor<CachedThreadTranscript>(
            predicate: #Predicate { $0.threadId == threadId }
        )
        descriptor.fetchLimit = 1
        guard let cached = try context.fetch(descriptor).first else { return nil }
        do {
            return try JSONDecoder().decode(TranscriptContainer.self, from: cached.rawJSON)
        } catch {
            AppLog.persistence.warning(
                "Ignoring invalid cached transcript for \(threadId): \(error)"
            )
            return nil
        }
    }

    func saveTranscript(threadId: String, environmentId: String, rawJSON: Data) throws {
        var descriptor = FetchDescriptor<CachedThreadTranscript>(
            predicate: #Predicate { $0.threadId == threadId }
        )
        descriptor.fetchLimit = 1
        if let existing = try context.fetch(descriptor).first {
            existing.environmentId = environmentId
            existing.rawJSON       = rawJSON
            existing.cachedAt      = .now
        } else {
            context.insert(
                CachedThreadTranscript(
                    threadId: threadId,
                    environmentId: environmentId,
                    rawJSON: rawJSON
                )
            )
        }
        let all = try context.fetch(
            FetchDescriptor<CachedThreadTranscript>(
                sortBy: [SortDescriptor(\.cachedAt, order: .reverse)]
            )
        )
        for stale in all.dropFirst(Self.transcriptCacheLimit) {
            context.delete(stale)
        }
        try context.save()
    }
}
