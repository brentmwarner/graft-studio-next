import SwiftUI

/// Reference-driven new-chat surface: choose a project and workspace mode in
/// the canvas, tune model/effort/permissions above the composer, then create
/// the configured remote thread with the first turn.
struct NewChatView: View {
    @Environment(AppModel.self) private var app
    var preselectedProjectId: String?
    /// When set (regular-width split), the created thread is selected in the
    /// sidebar instead of being pushed on this stack.
    var onOpenedThread: ((InboxThreadItem) -> Void)? = nil

    @State private var selectedProjectId: String?
    @State private var selectedMode = "local"
    @State private var selectedModelId: String?
    @State private var selectedProviderId: String?
    @State private var selectedEffort: String?
    @State private var selectedApprovalPolicy: String?
    @State private var draft = ""
    @State private var isCreating = false
    @State private var openedThread: InboxThreadItem?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 18) {
                Text("Let's work on", comment: "New chat project chooser heading")
                    .font(.title2.weight(.bold))

                projectMenu

                modePicker
                    .frame(maxWidth: 300)
            }
            .frame(maxWidth: .infinity)

            Spacer()

            composerDock
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
        .readableChatColumn()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .navigationTitle(Text("New chat", comment: "New mobile chat title"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                ChatNavigationTitle {
                    Text("New chat", comment: "New mobile chat title")
                        .font(.headline)
                        .lineLimit(1)
                        .accessibilityAddTraits(.isHeader)
                }
            }
        }
        .navigationDestination(item: $openedThread) { thread in
            ThreadView(threadId: thread.threadId, title: thread.title)
        }
        .task(id: app.gateway.state == .connected) {
            if selectedProjectId == nil {
                selectedProjectId = preselectedProjectId ?? projects.first?.id
            }
            await app.loadModelsIfNeeded()
        }
        .onChange(of: currentModel?.selectionID) {
            applyModelDefaults()
        }
        .onChange(of: selectedProjectId) {
            if !canUseWorktree {
                selectedMode = "local"
            }
        }
    }

    private var projectMenu: some View {
        Menu {
            ForEach(projects) { project in
                Button {
                    selectedProjectId = project.id
                } label: {
                    if project.id == selectedProjectId {
                        Label(project.name, systemImage: "checkmark")
                    } else {
                        Text(project.name)
                    }
                }
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "folder")
                Text(selectedProjectName)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .font(.title3.weight(.semibold))
            .foregroundStyle(.secondary)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Project", comment: "Choose the new chat's project"))
    }

    private var modePicker: some View {
        HStack(spacing: 0) {
            modeButton(value: "local", label: "Workspace")
            Divider()
            modeButton(value: "worktree", label: "Worktree")
                .disabled(!canUseWorktree)
                .opacity(canUseWorktree ? 1 : 0.4)
        }
        .frame(height: 50)
        .clipShape(.capsule)
    }

    private func modeButton(value: String, label: LocalizedStringKey) -> some View {
        Button {
            selectedMode = value
        } label: {
            HStack(spacing: 7) {
                if selectedMode == value {
                    Image(systemName: "checkmark")
                        .font(.body.weight(.medium))
                }
                Text(label)
                    .font(.body.weight(.semibold))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(selectedMode == value ? Color.secondary.opacity(0.14) : Color.clear)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private var composerDock: some View {
        VStack(alignment: .leading, spacing: 9) {
            GlassEffectContainer(spacing: 6) {
                HStack(spacing: 8) {
                    NewChatModelMenu(
                        catalog: app.models,
                        currentModel: currentModel,
                        selectedEffort: Binding(
                            get: { resolvedEffort },
                            set: { selectedEffort = $0 }
                        ),
                        onSelect: { model in
                            selectedModelId = model.id
                            selectedProviderId = model.providerId
                        },
                        onRefresh: { Task { await app.loadModelsIfNeeded(force: true) } }
                    )
                    .disabled(isCreating)
                    if !approvalOptions.isEmpty {
                        approvalMenu
                    }
                }
            }

            HStack(alignment: .bottom, spacing: 10) {
                composerOptionsMenu

                HStack(alignment: .bottom, spacing: 8) {
                    TextField(
                        "",
                        text: $draft,
                        prompt: Text(
                            "Work on \(hostLabel)",
                            comment: "New chat composer placeholder"
                        ),
                        axis: .vertical
                    )
                    .lineLimit(1...5)
                    .focused($focused)
                    .padding(.leading, 8)
                    .padding(.vertical, 8)

                    Button(action: send) {
                        Group {
                            if isCreating {
                                ProgressView()
                                    .tint(Color(.systemBackground))
                            } else if canSend {
                                Image(systemName: "arrow.up")
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(Color(.systemBackground))
                            } else {
                                Image(systemName: "mic")
                                    .font(.body)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .frame(width: 38, height: 38)
                        .background {
                            if canSend || isCreating {
                                Circle().fill(.primary)
                            }
                        }
                    }
                    .buttonStyle(PillPress())
                    .disabled(!canSend)
                    .accessibilityLabel(Text("Send", comment: "Start the new chat"))
                }
                .padding(.leading, 8)
                .padding(.trailing, 7)
                .padding(.vertical, 6)
                .glassEffect(.regular, in: .rect(cornerRadius: 26))
            }
        }
    }

    private var composerOptionsMenu: some View {
        Menu {
            Section("Workspace") {
                Button {
                    selectedMode = "local"
                } label: {
                    if selectedMode == "local" {
                        Label("Workspace", systemImage: "checkmark")
                    } else {
                        Text("Workspace")
                    }
                }
                if canUseWorktree {
                    Button {
                        selectedMode = "worktree"
                    } label: {
                        if selectedMode == "worktree" {
                            Label("Worktree", systemImage: "checkmark")
                        } else {
                            Text("Worktree")
                        }
                    }
                }
            }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(.primary)
                .frame(width: 50, height: 50)
                .contentShape(.circle)
                .glassEffect(.regular.interactive(), in: .circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Composer options")
    }

    @ViewBuilder
    private var approvalMenu: some View {
        let label = Text(approvalLabel)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(approvalIsElevated ? Color.orange : Color.primary)
            .lineLimit(1)
            .padding(.horizontal, 14)
            .frame(height: 38)
            .glassEffect(.regular.interactive(approvalOptions.count > 1), in: .capsule)
            .frame(minHeight: 44)
            .contentShape(.capsule)
        if approvalOptions.count <= 1 {
            label
                .accessibilityLabel("Permissions")
        } else {
            Menu {
                ForEach(approvalOptions) { option in
                    Button {
                        selectedApprovalPolicy = option.value
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(option.label)
                                if let description = option.description {
                                    Text(description)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer(minLength: 12)
                            if option.value == resolvedApprovalPolicy {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            } label: {
                label
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Permissions")
            .accessibilityIdentifier("new-chat-permissions")
        }
    }

    // MARK: Data

    private var projects: [InboxProjectGroup] {
        InboxGrouping.projects(from: app.snapshot, searchQuery: "")
    }

    private var hostLabel: String {
        app.environmentLabel
    }

    private var selectedProjectName: String {
        projects.first { $0.id == selectedProjectId }?.name
            ?? projects.first?.name
            ?? String(localized: "No project")
    }

    private var canUseWorktree: Bool {
        app.snapshot?.projects.first { $0.id == selectedProjectId }?.kind == "repo"
    }

    private var currentModel: ModelOption? {
        if let selectedModelId,
           let selected = app.availableModels.first(where: {
               $0.id == selectedModelId && $0.providerId == selectedProviderId
           }) {
            return selected
        }
        return app.availableModels.first { $0.isDefault == true }
            ?? app.availableModels.first
    }

    private var efforts: [String] {
        currentModel?.reasoningEfforts ?? []
    }

    private var resolvedEffort: String? {
        if let selectedEffort, efforts.contains(selectedEffort) {
            return selectedEffort
        }
        if let effort = currentModel?.defaultReasoningEffort, efforts.contains(effort) {
            return effort
        }
        if efforts.contains("xhigh") { return "xhigh" }
        if efforts.contains("high") { return "high" }
        return efforts.first
    }

    private var approvalOptions: [ApprovalPolicyOption] {
        currentModel?.approvalPolicyOptions ?? []
    }

    private var resolvedApprovalPolicy: String? {
        if let selectedApprovalPolicy,
           approvalOptions.contains(where: { $0.value == selectedApprovalPolicy }) {
            return selectedApprovalPolicy
        }
        return currentModel?.defaultApprovalPolicy ?? approvalOptions.first?.value
    }

    private var approvalLabel: String {
        approvalOptions.first { $0.value == resolvedApprovalPolicy }?.label
            ?? String(localized: "Permissions")
    }

    private var approvalIsElevated: Bool {
        guard let policy = resolvedApprovalPolicy,
              let baseline = currentModel?.defaultApprovalPolicy
        else { return false }
        return policy != baseline
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && selectedProjectId != nil
            && !isCreating
            && app.gateway.state == .connected
    }

    private func applyModelDefaults() {
        guard let model = currentModel else { return }
        selectedModelId = model.id
        selectedProviderId = model.providerId
        selectedEffort = nil
        selectedApprovalPolicy = model.defaultApprovalPolicy
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let projectId = selectedProjectId, !isCreating else {
            return
        }
        let model = currentModel
        let effort = resolvedEffort
        let approvalPolicy = resolvedApprovalPolicy
        isCreating = true
        Task {
            defer { isCreating = false }
            guard let thread = await app.createThread(
                projectId: projectId,
                mode: selectedMode,
                model: model,
                approvalPolicy: approvalPolicy
            ) else {
                return
            }
            await app.openThread(thread.id, title: thread.title)
            if let effort {
                app.setThreadEffort(threadId: thread.id, effort: effort)
            }
            _ = await app.activeChat?.send(text)
            draft = ""
            let item = InboxThreadItem(
                id: thread.id,
                title: thread.title,
                activity: .idle,
                environmentId: app.environmentId
            )
            if let onOpenedThread {
                onOpenedThread(item)
            } else {
                openedThread = item
            }
        }
    }
}

/// Native provider submenus mirror the desktop hierarchy. Intelligence is a
/// separate submenu for the selected model, keeping the first level compact.
struct NewChatModelMenu: View {
    let catalog: ModelSettingsStore
    let currentModel: ModelOption?
    @Binding var selectedEffort: String?
    let onSelect: (ModelOption) -> Void
    let onRefresh: () -> Void

    var body: some View {
        Menu {
            Section("Provider") {
                ForEach(catalog.providerGroups) { provider in
                    Menu {
                        ForEach(provider.models, id: \.selectionID) { model in
                            Button {
                                onSelect(model)
                            } label: {
                                if model.selectionID == currentModel?.selectionID {
                                    Label(model.label, systemImage: "checkmark")
                                } else {
                                    Text(model.label)
                                }
                            }
                            .accessibilityIdentifier("new-chat-model-\(model.selectionID)")
                        }
                    } label: {
                        Label {
                            Text(provider.label)
                        } icon: {
                            ProviderLogo.image(for: provider.id) ?? Image(systemName: "cpu")
                        }
                    }
                    .accessibilityAddTraits(currentModel?.providerId == provider.id ? .isSelected : [])
                    .accessibilityIdentifier("new-chat-provider-\(provider.id)")
                }
            }

            if let efforts = currentModel?.reasoningEfforts, !efforts.isEmpty {
                Section {
                    Menu {
                        Picker("Intelligence", selection: $selectedEffort) {
                            ForEach(efforts, id: \.self) { effort in
                                Text(ComposerView.effortDisplayName(effort)).tag(Optional(effort))
                            }
                        }
                        .pickerStyle(.inline)
                    } label: {
                        Text("Intelligence: \(ComposerView.effortDisplayName(selectedEffort ?? ""))")
                    }
                    .accessibilityIdentifier("new-chat-intelligence")
                }
            }

            if catalog.isLoading {
                Text("Loading models…")
            } else if let error = catalog.loadError {
                Section {
                    Text(error)
                    Button("Retry", systemImage: "arrow.clockwise", action: onRefresh)
                }
            } else if catalog.providerGroups.isEmpty {
                Button("Load models", systemImage: "arrow.clockwise", action: onRefresh)
            }
        } label: {
            Text(chipLabel)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .padding(.horizontal, 14)
                .frame(minHeight: 38)
                .glassEffect(.regular.interactive(), in: .capsule)
                .frame(minHeight: 44)
                .contentShape(.capsule)
        }
        .menuOrder(.fixed)
        .buttonStyle(.plain)
        .accessibilityLabel("Provider, model, and intelligence")
        .accessibilityValue(chipLabel)
        .accessibilityIdentifier("new-chat-model-settings")
    }

    private var chipLabel: String {
        let model = currentModel?.label ?? String(localized: "Choose model")
        guard let effort = selectedEffort else { return model }
        return "\(model) \(ComposerView.effortDisplayName(effort))"
    }
}

#Preview {
    NavigationStack {
        NewChatView()
            .environment(AppModel())
    }
}
