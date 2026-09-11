import SwiftUI

/// Bottom-sheet picker for the composer's model stack. The root screen keeps
/// only the model list inline; provider and reasoning effort are single rows
/// that push selection screens, so the sheet never shows all three catalogs
/// at once.
struct ModelPickerSheet: View {
    @Environment(AppModel.self) private var app
    let chat: ChatModel

    /// Provider chosen this presentation, ahead of the host round-trip.
    /// Keeps the model list on the new provider while `setThreadModel`
    /// confirms; the checkmark still follows the host-reported model.
    @State private var chosenProviderId: String?

    var body: some View {
        NavigationStack {
            List {
                if groupedModels.count > 1 {
                    Section {
                        NavigationLink {
                            ProviderPickerList(
                                items: groupedModels.map {
                                    ProviderPickerList.Item(id: $0.providerId, title: $0.title)
                                },
                                selectedId: displayedProviderId,
                                onSelect: { selectProvider($0) }
                            )
                        } label: {
                            HStack(spacing: 10) {
                                ProviderLogoView(
                                    providerId: displayedProviderId ?? "",
                                    label: displayedProviderTitle
                                )
                                Text(displayedProviderTitle)
                            }
                        }
                    } header: {
                        PlainHeader("Provider")
                    }
                }

                Section {
                    ForEach(currentProviderModels) { model in
                        pickerRow(isSelected: model.id == currentModel?.id) {
                            selectModel(model)
                        } content: {
                            Text(model.label)
                        }
                    }
                } header: {
                    PlainHeader("Model")
                }

                if let efforts = currentModel?.reasoningEfforts, !efforts.isEmpty {
                    let currentEffort = app.resolvedEffort(forThread: chat.threadId)
                    Section {
                        NavigationLink {
                            EffortPickerList(
                                efforts: efforts,
                                selectedEffort: currentEffort,
                                onSelect: {
                                    app.setThreadEffort(threadId: chat.threadId, effort: $0)
                                }
                            )
                        } label: {
                            Text(
                                ComposerView.effortDisplayName(
                                    currentEffort ?? efforts[0]
                                )
                            )
                        }
                    } header: {
                        PlainHeader("Reasoning effort")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .drawerSurface()
        }
    }

    private func pickerRow(
        isSelected: Bool,
        action: @escaping () -> Void,
        @ViewBuilder content: () -> some View
    ) -> some View {
        Button(action: action) {
            HStack {
                content()
                    .foregroundStyle(.primary)
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.bubble)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    // MARK: Data

    private var currentModel: ModelOption? {
        app.currentModel(forThread: chat.threadId)
    }

    private var displayedProviderId: String? {
        chosenProviderId ?? currentModel?.providerId
    }

    private var displayedProviderTitle: String {
        guard let providerId = displayedProviderId else { return "Provider" }
        return groupedModels.first { $0.providerId == providerId }?.title
            ?? providerId.capitalized
    }

    private var groupedModels: [(providerId: String, title: String, models: [ModelOption])] {
        var order: [String] = []
        var byProvider: [String: [ModelOption]] = [:]
        for model in app.availableModels {
            if byProvider[model.providerId] == nil { order.append(model.providerId) }
            byProvider[model.providerId, default: []].append(model)
        }
        return order.map { providerId in
            (
                providerId: providerId,
                title: byProvider[providerId]?.first?.providerLabel
                    ?? providerId.capitalized,
                models: byProvider[providerId] ?? []
            )
        }
    }

    /// Models offered for the displayed provider; a thread whose model the
    /// catalog doesn't know falls back to the full list.
    private var currentProviderModels: [ModelOption] {
        guard let providerId = displayedProviderId, !providerId.isEmpty
        else { return app.availableModels }
        let scoped = app.availableModels.filter { $0.providerId == providerId }
        return scoped.isEmpty ? app.availableModels : scoped
    }

    /// Switching provider lands on that provider's default model.
    private func selectProvider(_ providerId: String) {
        chosenProviderId = providerId
        let models = groupedModels.first { $0.providerId == providerId }?.models ?? []
        guard let target = models.first(where: { $0.isDefault == true }) ?? models.first
        else { return }
        selectModel(target)
    }

    private func selectModel(_ model: ModelOption) {
        Task {
            _ = await app.setThreadModel(threadId: chat.threadId, model: model)
        }
    }
}

/// Pushed screen listing the model's reasoning efforts; selecting one reports
/// back and pops.
private struct EffortPickerList: View {
    let efforts: [String]
    let selectedEffort: String?
    let onSelect: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Section {
                ForEach(efforts, id: \.self) { effort in
                    Button {
                        onSelect(effort)
                        dismiss()
                    } label: {
                        HStack {
                            Text(ComposerView.effortDisplayName(effort))
                                .foregroundStyle(.primary)
                            Spacer()
                            if effort == selectedEffort {
                                Image(systemName: "checkmark")
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(Theme.bubble)
                            }
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .listStyle(.insetGrouped)
        .drawerSurface()
        .navigationTitle("Reasoning effort")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Pushed screen listing every provider; selecting one reports back and pops.
private struct ProviderPickerList: View {
    struct Item: Identifiable {
        let id: String
        let title: String
    }

    let items: [Item]
    let selectedId: String?
    let onSelect: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Section {
                ForEach(items) { item in
                    Button {
                        onSelect(item.id)
                        dismiss()
                    } label: {
                        HStack {
                            HStack(spacing: 10) {
                                ProviderLogoView(providerId: item.id, label: item.title)
                                Text(item.title)
                            }
                            .foregroundStyle(.primary)
                            Spacer()
                            if item.id == selectedId {
                                Image(systemName: "checkmark")
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(Theme.bubble)
                            }
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .listStyle(.insetGrouped)
        .drawerSurface()
        .navigationTitle("Provider")
        .navigationBarTitleDisplayMode(.inline)
    }
}
