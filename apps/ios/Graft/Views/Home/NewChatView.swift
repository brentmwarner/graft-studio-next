import SwiftUI

/// Reference-driven new-chat surface: choose a project and workspace mode in
/// the canvas, tune model/effort/permissions above the composer, then create
/// the configured remote thread with the first turn.
struct NewChatView: View {
    @Environment(AppModel.self) private var app
    var preselectedProjectId: String?

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
        .background(Color(.systemBackground))
        .navigationTitle(Text("New chat", comment: "New mobile chat title"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $openedThread) { thread in
            ThreadView(threadId: thread.id, title: thread.title)
        }
        .task {
            if selectedProjectId == nil {
                selectedProjectId = preselectedProjectId ?? projects.first?.id
            }
            await app.loadModelsIfNeeded()
            applyModelDefaults()
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
        .overlay(Capsule().stroke(Color.secondary.opacity(0.28), lineWidth: 1))
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
            HStack(spacing: 8) {
                modelSettingsMenu
                if !approvalOptions.isEmpty {
                    approvalMenu
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

    private var modelSettingsMenu: some View {
        Menu {
            if !efforts.isEmpty {
                Section("Intelligence") {
                    ForEach(efforts, id: \.self) { effort in
                        Button {
                            selectedEffort = effort
                        } label: {
                            if effort == resolvedEffort {
                                Label(
                                    ComposerView.effortDisplayName(effort),
                                    systemImage: "checkmark"
                                )
                            } else {
                                Text(ComposerView.effortDisplayName(effort))
                            }
                        }
                    }
                }
            }
            Section("Model") {
                ForEach(app.availableModels, id: \.selectionID) { model in
                    Button {
                        selectedModelId = model.id
                        selectedProviderId = model.providerId
                    } label: {
                        if model.selectionID == currentModel?.selectionID {
                            Label(model.label, systemImage: "checkmark")
                        } else {
                            Text(model.label)
                        }
                    }
                }
            }
            Section("Speed") {
                Label("Normal", systemImage: "checkmark")
            }
        } label: {
            Text(modelChipLabel)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .padding(.horizontal, 14)
                .frame(height: 38)
                .background(Color.secondary.opacity(0.12), in: .capsule)
        }
        .buttonStyle(.plain)
        .disabled(app.availableModels.isEmpty)
        .accessibilityLabel("Model and reasoning effort")
    }

    @ViewBuilder
    private var approvalMenu: some View {
        let label = Text(approvalLabel)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(approvalIsElevated ? Color.orange : Color.primary)
            .lineLimit(1)
            .padding(.horizontal, 14)
            .frame(height: 38)
            .background(Color.secondary.opacity(0.12), in: .capsule)
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
        }
    }

    // MARK: Data

    private var projects: [InboxProjectGroup] {
        InboxGrouping.projects(from: app.snapshot, searchQuery: "")
    }

    private var hostLabel: String {
        if let label = app.connection.session?.environmentLabel, !label.isEmpty {
            return label
        }
        return "Studio"
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

    private var modelChipLabel: String {
        let model = currentModel?.label ?? String(localized: "Model")
        guard let effort = resolvedEffort else { return model }
        return "\(model) \(ComposerView.effortDisplayName(effort))"
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
        selectedEffort = {
            let efforts = model.reasoningEfforts ?? []
            if efforts.contains("xhigh") { return "xhigh" }
            if efforts.contains("high") { return "high" }
            return efforts.first
        }()
        selectedApprovalPolicy = model.defaultApprovalPolicy
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let projectId = selectedProjectId, !isCreating else {
            return
        }
        isCreating = true
        Task {
            defer { isCreating = false }
            guard let thread = await app.createThread(
                projectId: projectId,
                mode: selectedMode,
                model: currentModel,
                approvalPolicy: resolvedApprovalPolicy
            ) else {
                return
            }
            if let effort = resolvedEffort {
                app.setThreadEffort(threadId: thread.id, effort: effort)
            }
            await app.openThread(thread.id, title: thread.title)
            _ = await app.activeChat?.send(text)
            draft = ""
            openedThread = InboxThreadItem(
                id: thread.id,
                title: thread.title,
                showsAttentionDot: false
            )
        }
    }
}

#Preview {
    NavigationStack {
        NewChatView()
            .environment(AppModel())
    }
}
