import Foundation
import Observation

/// Shared discovery and mutation state for every model control. A failed
/// discovery remains retryable, and selections are confirmed by Studio.
@MainActor
@Observable
final class ModelSettingsStore {
    private(set) var availableModels: [ModelOption] = []
    private(set) var providerGroups: [ModelProviderGroup] = []
    private(set) var isLoading = false
    private(set) var loadError: String?
    private(set) var pendingSelections: [String: String] = [:]
    private(set) var selectionErrors: [String: String] = [:]

    @ObservationIgnored private var catalogTask: Task<[ModelOption], Error>?
    @ObservationIgnored private var generation = 0

    func load(
        force: Bool = false,
        using request: @escaping @MainActor () async throws -> [ModelOption]
    ) async {
        if let catalogTask {
            _ = try? await catalogTask.value
            return
        }
        guard force || availableModels.isEmpty else { return }
        let requestGeneration = generation
        isLoading = true
        loadError = nil
        let task = Task { try await request() }
        catalogTask = task
        defer {
            if generation == requestGeneration {
                isLoading = false
                catalogTask = nil
            }
        }
        do {
            let models = try await task.value
            guard generation == requestGeneration else { return }
            guard !models.isEmpty else {
                loadError = "Studio has no models available. Check its provider settings, then retry."
                return
            }
            availableModels = models
            providerGroups = ModelProviderGroup.group(models)
        } catch {
            guard generation == requestGeneration else { return }
            loadError = error.localizedDescription
        }
    }

    func select(
        _ model: ModelOption,
        threadId: String,
        currentProviderId: String?,
        canChangeProvider: Bool,
        using request: @MainActor () async throws -> ThreadInfo
    ) async -> ThreadInfo? {
        guard pendingSelections[threadId] == nil else { return nil }
        guard canChangeProvider || model.providerId == currentProviderId else {
            selectionErrors[threadId] = "Start a new chat to use a different provider."
            return nil
        }
        let requestGeneration = generation
        pendingSelections[threadId] = model.selectionID
        selectionErrors[threadId] = nil
        defer {
            if generation == requestGeneration {
                pendingSelections[threadId] = nil
            }
        }
        do {
            let thread = try await request()
            guard generation == requestGeneration else { return nil }
            guard thread.id == threadId else {
                throw GraftError.decoding("Studio returned a different chat.")
            }
            return thread
        } catch {
            guard generation == requestGeneration else { return nil }
            selectionErrors[threadId] = error.localizedDescription
            return nil
        }
    }

    func reset() {
        generation += 1
        catalogTask?.cancel()
        catalogTask = nil
        availableModels = []
        providerGroups = []
        isLoading = false
        loadError = nil
        pendingSelections = [:]
        selectionErrors = [:]
    }
}

/// Preserve Studio's provider and model order, including models offered by
/// more than one provider. Rebuilt only when discovery changes the catalog.
struct ModelProviderGroup: Identifiable {
    let id: String
    let label: String
    var models: [ModelOption]

    static func group(_ models: [ModelOption]) -> [Self] {
        var groups: [Self] = []
        var indices: [String: Int] = [:]
        for model in models {
            if let index = indices[model.providerId] {
                groups[index].models.append(model)
            } else {
                indices[model.providerId] = groups.count
                groups.append(Self(
                    id: model.providerId,
                    label: model.providerLabel ?? model.providerId,
                    models: [model]
                ))
            }
        }
        return groups
    }
}
