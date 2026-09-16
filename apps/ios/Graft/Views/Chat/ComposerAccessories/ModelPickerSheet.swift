import SwiftUI
import UIKit

/// Partial-height sheets supply native Liquid Glass on iOS 26. Keep the
/// content background clear so the system can adapt it at each detent.
struct ModelPickerSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let chat: ChatModel

    private var model: ModelOption? { app.currentModel(forThread: chat.threadId) }
    private var isSaving: Bool { app.models.pendingSelections[chat.threadId] != nil }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    NavigationLink {
                        ModelSelectionList(chat: chat)
                    } label: {
                        HStack(spacing: 8) {
                            Text("Advanced")
                            Image(systemName: "chevron.forward")
                        }
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Browse models")
                    .accessibilityIdentifier("model-settings-browse")
                    .padding(.bottom, 12)

                    VStack(spacing: 0) {
                        if app.canChangeProvider(forThread: chat.threadId) {
                            ModelProviderMenu(chat: chat)
                            Divider().padding(.horizontal, 18)
                        }
                        ModelSelectionMenu(chat: chat)

                        if let efforts = model?.reasoningEfforts, !efforts.isEmpty {
                            Divider().padding(.horizontal, 18)
                            Menu {
                                Picker("Intelligence", selection: effortBinding) {
                                    ForEach(efforts, id: \.self) { effort in
                                        Text(ComposerView.effortDisplayName(effort)).tag(effort)
                                    }
                                }
                            } label: {
                                ModelSettingRow(
                                    title: "Intelligence",
                                    value: ComposerView.effortDisplayName(effortBinding.wrappedValue)
                                )
                            }
                            .disabled(isSaving)
                            .accessibilityIdentifier("model-settings-intelligence")
                        }
                    }
                    .background(Color(uiColor: .secondarySystemFill), in: .rect(cornerRadius: 24))

                    if let fastMode = app.resolvedFastMode(forThread: chat.threadId) {
                        Menu {
                            Picker("Speed", selection: Binding(
                                get: { app.resolvedFastMode(forThread: chat.threadId) ?? false },
                                set: { value in
                                    UISelectionFeedbackGenerator().selectionChanged()
                                    app.setThreadFastMode(threadId: chat.threadId, enabled: value)
                                }
                            )) {
                                Text("Standard").tag(false)
                                Text("Fast").tag(true)
                            }
                        } label: {
                            ModelSettingRow(title: "Speed", value: fastMode ? "Fast" : "Standard")
                        }
                        .disabled(isSaving)
                        .background(Color(uiColor: .secondarySystemFill), in: .capsule)
                        .accessibilityIdentifier("model-settings-speed")
                        .padding(.top, 36)
                    }

                    if app.models.isLoading || app.models.loadError != nil || app.models.selectionErrors[chat.threadId] != nil {
                        ModelSettingsStatus(threadId: chat.threadId)
                            .padding(.top, 24)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 14)
                .padding(.bottom, 24)
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .accessibilityAction(.escape) { dismiss() }
        .task(id: app.gateway.state == .connected) {
            await app.loadModelsIfNeeded()
        }
    }

    private var effortBinding: Binding<String> {
        Binding(
            get: { app.resolvedEffort(forThread: chat.threadId) ?? "" },
            set: { effort in
                UISelectionFeedbackGenerator().selectionChanged()
                app.setThreadEffort(threadId: chat.threadId, effort: effort)
            }
        )
    }
}

private struct ModelSettingRow: View {
    let title: String
    let value: String
    var isSaving = false

    var body: some View {
        HStack(spacing: 16) {
            Text(title)
            Spacer(minLength: 12)
            if isSaving { ProgressView().controlSize(.small) }
            Text(value)
                .multilineTextAlignment(.trailing)
            Image(systemName: "chevron.up.chevron.down")
                .font(.caption.weight(.semibold))
        }
        .font(.body)
        .foregroundStyle(.primary)
        .padding(.horizontal, 18)
        .padding(.vertical, 13)
        .frame(minHeight: 50)
        .contentShape(.rect)
    }
}

private struct ModelSelectionMenu: View {
    @Environment(AppModel.self) private var app
    let chat: ChatModel

    var body: some View {
        let current = app.currentModel(forThread: chat.threadId)
        Menu {
            ForEach(app.availableModels.filter { $0.providerId == current?.providerId }, id: \.selectionID) { model in
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    Task { await app.setThreadModel(threadId: chat.threadId, model: model) }
                } label: {
                    if model.selectionID == current?.selectionID {
                        Label(model.label, systemImage: "checkmark")
                    } else {
                        Text(model.label)
                    }
                }
            }
            Button("Refresh models", systemImage: "arrow.clockwise") {
                Task { await app.loadModelsIfNeeded(force: true) }
            }
        } label: {
            ModelSettingRow(
                title: "Model", value: current?.label ?? "Choose model",
                isSaving: app.models.pendingSelections[chat.threadId] != nil
            )
        }
        .disabled(app.models.pendingSelections[chat.threadId] != nil)
        .accessibilityIdentifier("model-settings-model")
    }
}

private struct ModelProviderMenu: View {
    @Environment(AppModel.self) private var app
    let chat: ChatModel

    var body: some View {
        let current = app.currentModel(forThread: chat.threadId)
        let providers = app.availableModels.reduce(into: [ModelOption]()) { result, model in
            if !result.contains(where: { $0.providerId == model.providerId }) { result.append(model) }
        }
        Menu {
            ForEach(providers, id: \.providerId) { provider in
                Button {
                    let models = app.availableModels.filter { $0.providerId == provider.providerId }
                    guard let target = models.first(where: { $0.isDefault == true }) ?? models.first else { return }
                    UISelectionFeedbackGenerator().selectionChanged()
                    Task { await app.setThreadModel(threadId: chat.threadId, model: target) }
                } label: {
                    Label(provider.providerLabel ?? provider.providerId, systemImage:
                        provider.providerId == current?.providerId ? "checkmark" : "circle")
                }
            }
        } label: {
            ModelSettingRow(title: "Provider", value: current?.providerLabel ?? current?.providerId ?? "Choose provider")
        }
        .disabled(providers.isEmpty || app.models.pendingSelections[chat.threadId] != nil)
    }
}

private struct ModelSelectionList: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    let chat: ChatModel

    var body: some View {
        let current = app.currentModel(forThread: chat.threadId)
        let models = app.availableModels.filter {
            $0.providerId == current?.providerId &&
                (search.isEmpty || $0.label.localizedStandardContains(search) || $0.id.localizedStandardContains(search))
        }
        List {
            Section {
                ForEach(models, id: \.selectionID) { model in
                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        Task {
                            if await app.setThreadModel(threadId: chat.threadId, model: model) { dismiss() }
                        }
                    } label: {
                        HStack(spacing: 14) {
                            Text(model.label).foregroundStyle(.primary)
                            Spacer(minLength: 8)
                            if app.models.pendingSelections[chat.threadId] == model.selectionID {
                                ProgressView().controlSize(.small)
                            } else if current?.selectionID == model.selectionID {
                                Image(systemName: "checkmark").font(.body.weight(.semibold))
                            }
                        }
                        .frame(minHeight: 32)
                        .contentShape(.rect)
                    }
                    .disabled(app.models.pendingSelections[chat.threadId] != nil)
                    .listRowBackground(Color.primary.opacity(0.045))
                    .accessibilityIdentifier("model-option-\(model.selectionID)")
                }
            }
            Section {
                ModelSettingsStatus(threadId: chat.threadId)
                if models.isEmpty, !app.models.isLoading, app.models.loadError == nil {
                    Text(search.isEmpty ? "No models available for this provider." : "No matching models.")
                        .foregroundStyle(.secondary)
                }
                Button("Refresh models", systemImage: "arrow.clockwise") {
                    Task { await app.loadModelsIfNeeded(force: true) }
                }
                .disabled(app.models.isLoading)
            }
            .listRowBackground(Color.clear)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .searchable(text: $search, prompt: "Search models")
        .navigationTitle("Model")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
    }
}

struct ModelSettingsStatus: View {
    @Environment(AppModel.self) private var app
    let threadId: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if app.models.isLoading {
                HStack(spacing: 10) {
                    ProgressView().controlSize(.small)
                    Text("Loading models…").foregroundStyle(.secondary)
                }
            }
            if let error = app.models.selectionErrors[threadId] {
                Text(error).foregroundStyle(.red)
                    .accessibilityIdentifier("model-selection-error")
            }
            if let error = app.models.loadError {
                Text(error).foregroundStyle(.secondary)
                Button("Retry", systemImage: "arrow.clockwise") {
                    Task { await app.loadModelsIfNeeded(force: true) }
                }
                .frame(minHeight: 44)
                .accessibilityIdentifier("model-load-retry")
            }
        }
        .font(.footnote)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The presentation places these controls over the composer's existing bounds.
/// Advanced opens the settings sheet after dismissing that presentation.
struct ModelQuickControls: View {
    @Environment(AppModel.self) private var app
    let threadId: String
    let onAdvanced: () -> Void

    var body: some View {
        let model = app.currentModel(forThread: threadId)
        let effort = app.resolvedEffort(forThread: threadId)
        VStack(spacing: 8) {
            Button(action: onAdvanced) {
                HStack(spacing: 6) {
                    Text(model?.label ?? "Choose model").fontWeight(.medium)
                    if let effort {
                        Text(ComposerView.effortDisplayName(effort)).foregroundStyle(.secondary)
                    }
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                }
                .font(.title2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Advanced model settings")
            .accessibilityValue([model?.label, effort.map(ComposerView.effortDisplayName)].compactMap { $0 }.joined(separator: ", "))
            .accessibilityIdentifier("model-quick-advanced")

            if let efforts = model?.reasoningEfforts, efforts.count > 1 {
                ModelEffortSlider(efforts: efforts, selected: effort) { choice in
                    app.setThreadEffort(threadId: threadId, effort: choice)
                }
                .disabled(app.models.pendingSelections[threadId] != nil)
            }
            if app.models.isLoading || app.models.loadError != nil || app.models.selectionErrors[threadId] != nil {
                ModelSettingsStatus(threadId: threadId)
                    .padding(16)
                    .glassEffect(.regular, in: .rect(cornerRadius: 24))
            }
        }
        .frame(maxWidth: 344)
        .task { await app.loadModelsIfNeeded() }
    }
}

/// A scene-owned presentation replacing the composer. The source editor stays
/// mounted in its original window, so dismissing restores the same draft/caret.
struct ModelControlsPresentation: UIViewRepresentable {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.layoutDirection) private var layoutDirection

    let isPresented: Bool
    let threadId: String
    let app: AppModel
    let onDismiss: () -> Void
    let onAdvanced: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> ModelControlsAnchor {
        let view = ModelControlsAnchor()
        view.isUserInteractionEnabled = false
        view.layoutChanged = { [weak coordinator = context.coordinator, weak view] in
            guard let view else { return }
            coordinator?.update(from: view)
        }
        return view
    }

    func updateUIView(_ view: ModelControlsAnchor, context: Context) {
        context.coordinator.configuration = self
        context.coordinator.update(from: view)
    }

    static func dismantleUIView(_ view: ModelControlsAnchor, coordinator: Coordinator) {
        view.layoutChanged = nil
        coordinator.hide()
    }

    @MainActor
    final class Coordinator {
        var configuration: ModelControlsPresentation?
        private var window: UIWindow?
        private var controller: ModelControlsHostingController?

        func update(from anchor: UIView) {
            guard let configuration, configuration.isPresented,
                  let sourceWindow = anchor.window, let scene = sourceWindow.windowScene,
                  !sourceWindow.isHidden, anchor.bounds.width > 0 else {
                hide()
                return
            }
            let composerFrame = anchor.convert(anchor.bounds, to: sourceWindow)
            let root = ModelControlsOverlay(
                composerFrame: composerFrame,
                threadId: configuration.threadId,
                app: configuration.app,
                colorScheme: configuration.colorScheme,
                dynamicTypeSize: configuration.dynamicTypeSize,
                layoutDirection: configuration.layoutDirection,
                onDismiss: { [weak self] in
                    self?.hide()
                    configuration.onDismiss()
                },
                onAdvanced: { [weak self] in
                    self?.hide()
                    configuration.onAdvanced()
                }
            )

            if let controller, let window {
                window.frame = sourceWindow.bounds
                window.overrideUserInterfaceStyle = sourceWindow.traitCollection.userInterfaceStyle
                controller.rootView = root
            } else {
                let controller = ModelControlsHostingController(rootView: root)
                controller.safeAreaRegions = []
                controller.view.backgroundColor = .clear
                controller.view.accessibilityViewIsModal = true
                let window = UIWindow(windowScene: scene)
                window.frame = sourceWindow.bounds
                window.windowLevel = .alert
                window.backgroundColor = .clear
                window.overrideUserInterfaceStyle = sourceWindow.traitCollection.userInterfaceStyle
                window.accessibilityIdentifier = "model-controls-window"
                window.rootViewController = controller
                self.controller = controller
                self.window = window
                // Do not make this window key: the source text view owns focus.
                window.isHidden = false
            }
        }

        func hide() {
            window?.isHidden = true
            window?.rootViewController = nil
            window = nil
            controller = nil
        }
    }
}

final class ModelControlsAnchor: UIView {
    var layoutChanged: (() -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
        layoutChanged?()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        layoutChanged?()
    }
}

private final class ModelControlsHostingController: UIHostingController<ModelControlsOverlay> {
    override func accessibilityPerformEscape() -> Bool {
        rootView.onDismiss()
        return true
    }
}

private struct ModelControlsOverlay: View {
    let composerFrame: CGRect
    let threadId: String
    let app: AppModel
    let colorScheme: ColorScheme
    let dynamicTypeSize: DynamicTypeSize
    let layoutDirection: LayoutDirection
    let onDismiss: () -> Void
    let onAdvanced: () -> Void

    var body: some View {
        GeometryReader { geometry in
            let bottom = min(composerFrame.maxY - 8, geometry.size.height - 16)
            let blurStart = max(0, min(composerFrame.minY - 100, bottom - 224))
            let height = max(geometry.size.height, 1)
            let keyboardVisible = height - bottom > 200

            ZStack(alignment: .bottom) {
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .mask {
                        LinearGradient(stops: [
                            .init(color: .clear, location: blurStart / height),
                            .init(color: .black, location: min((blurStart + 72) / height, 1)),
                            .init(color: .black, location: min((bottom + 32) / height, 1)),
                            .init(color: keyboardVisible ? .clear : .black,
                                  location: min((bottom + 152) / height, 1)),
                        ], startPoint: .top, endPoint: .bottom)
                    }
                    .allowsHitTesting(false)

                Color.clear
                    .contentShape(.rect)
                    .onTapGesture(perform: onDismiss)
                    .accessibilityHidden(true)

                ModelQuickControls(threadId: threadId, onAdvanced: onAdvanced)
                    .environment(app)
                    .padding(.horizontal, 16)
                    .padding(.bottom, max(geometry.size.height - bottom, 0))
            }
        }
        .ignoresSafeArea()
        .environment(\.colorScheme, colorScheme)
        .environment(\.dynamicTypeSize, dynamicTypeSize)
        .environment(\.layoutDirection, layoutDirection)
        .accessibilityAction(.escape, onDismiss)
    }
}

struct ModelEffortSlider: View {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dragProgress: CGFloat?

    let efforts: [String]
    let selected: String?
    let onSelect: (String) -> Void

    private let inset: CGFloat = 12
    private let trackHeight: CGFloat = 48
    private let thumbSize: CGFloat = 40

    private var selectedIndex: Int { efforts.firstIndex(of: selected ?? "") ?? 0 }
    private var lastIndex: Int { max(efforts.count - 1, 1) }

    var body: some View {
        GeometryReader { geometry in
            let travel = max(geometry.size.width - inset * 2 - trackHeight, 1)
            let progress = dragProgress ?? CGFloat(selectedIndex) / CGFloat(lastIndex)
            let center = inset + trackHeight / 2 + travel * progress

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(.black)
                    .frame(width: trackHeight + travel * progress, height: trackHeight)
                    .frame(maxWidth: .infinity, alignment: layoutDirection == .rightToLeft ? .trailing : .leading)
                    .padding(.horizontal, inset)

                ForEach(efforts, id: \.self) { effort in
                    let index = efforts.firstIndex(of: effort) ?? 0
                    let position = CGFloat(index) / CGFloat(lastIndex)
                    Circle()
                        .fill(position <= progress ? Color.white.opacity(0.22) : Color.primary.opacity(0.22))
                        .frame(width: 12, height: 12)
                        .position(
                            x: physicalX(inset + trackHeight / 2 + travel * position, width: geometry.size.width),
                            y: geometry.size.height / 2
                        )
                }

                Circle()
                    .fill(.white)
                    .frame(width: thumbSize, height: thumbSize)
                    .position(x: physicalX(center, width: geometry.size.width), y: geometry.size.height / 2)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(
                dragProgress == nil && !reduceMotion ? .smooth(duration: 0.16) : nil,
                value: dragProgress
            )
            .contentShape(.capsule)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        guard isEnabled, efforts.count > 1 else { return }
                        let x = physicalX(value.location.x, width: geometry.size.width)
                        let progress = min(max((x - inset - trackHeight / 2) / travel, 0), 1)
                        dragProgress = progress
                        select(Int((progress * CGFloat(lastIndex)).rounded()))
                    }
                    .onEnded { _ in
                        dragProgress = nil
                    }
            )
        }
        // Keep one physical coordinate space for drawing and touch locations;
        // apply the reader's direction exactly once through physicalX/alignment.
        .environment(\.layoutDirection, .leftToRight)
        .frame(height: 72)
        .glassEffect(.regular, in: .capsule)
        .opacity(isEnabled ? 1 : 0.5)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Intelligence")
        .accessibilityValue(ComposerView.effortDisplayName(selected ?? efforts.first ?? ""))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: select(selectedIndex + 1)
            case .decrement: select(selectedIndex - 1)
            @unknown default: break
            }
        }
        .accessibilityIdentifier("model-effort-slider")
        .sensoryFeedback(.selection, trigger: selected)
        .onChange(of: isEnabled) { _, enabled in
            if !enabled { dragProgress = nil }
        }
    }

    private func physicalX(_ logicalX: CGFloat, width: CGFloat) -> CGFloat {
        layoutDirection == .rightToLeft ? width - logicalX : logicalX
    }

    private func select(_ index: Int) {
        guard isEnabled, efforts.indices.contains(index), efforts[index] != selected else { return }
        onSelect(efforts[index])
    }
}
