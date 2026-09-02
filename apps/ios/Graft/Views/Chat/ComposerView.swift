import PhotosUI
import UIKit
import SwiftUI
import UniformTypeIdentifiers

private enum ComposerLayout {
    static let editorVerticalPadding: CGFloat = 13
    static let attachmentStripHeight: CGFloat = 56
    static let attachmentVerticalPadding: CGFloat = 12
    static let attachmentChromeHeight = attachmentStripHeight + attachmentVerticalPadding
}

/// Floating Liquid Glass composer: an attach button on the left and a glass
/// text capsule whose trailing control morphs between mic (idle), send
/// (drafting), and stop (streaming) — all living inside the input.
struct ComposerView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    let chat: ChatModel
    let siblingChromeHeight: CGFloat
    /// Live voice mode isn't part of the Graft port yet; nil hides the
    /// waveform affordance entirely instead of showing a dead control.
    var onStartLiveMode: (() -> Void)? = nil

    @State private var text = ""
    @State private var voice = VoiceModel()
    /// Imperative bridge to the field's `UITextView` so a finished transcript
    /// lands at the caret instead of always being tacked onto the end.
    @State private var textController = ComposerTextController()
    @State private var slash = SlashCompleter()
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showPhotos = false
    @State private var showFiles = false
    @State private var showCamera = false
    @State private var attachmentError: String?
    @State private var isDropTargeted = false
    /// The UIKit editor reports its measured height through a binding so the
    /// surrounding SwiftUI stack participates in layout as the draft wraps.
    /// One body line is ~20pt at the default Dynamic Type size.
    @State private var editorHeight: CGFloat = 20
    // Plain @State, not @FocusState: the editor is a bridged UITextView, so no
    // SwiftUI focus field ever claims a @FocusState value — writes would reset
    // and reads would always be false. UIKit's delegate callbacks keep this in
    // sync instead (begin/end editing in PasteAwareComposerTextView).
    @State private var focused: Bool = false
    @State private var showModelSheet = false

    /// Shared collapsed height for the attach button and the text capsule so
    /// the two read as one balanced row. `@ScaledMetric` keeps them locked
    /// together as Dynamic Type changes the text size.
    @ScaledMetric(relativeTo: .body) private var controlHeight: CGFloat = 46

    /// Floor for the text area while the composer is open. Three body lines —
    /// the card should read as a place to write, not a slit that happens to
    /// have controls under it.
    @ScaledMetric(relativeTo: .body) private var expandedEditorMinHeight: CGFloat = 60

    var body: some View {
        @Bindable var chat = chat
        let attachmentChromeHeight = chat.attachments.isEmpty
            ? 0
            : ComposerLayout.attachmentChromeHeight
        VStack(spacing: 8) {
            if text.hasPrefix("/"), !slash.items.isEmpty {
                SlashPalette(completions: slash.items) { picked in
                    // Fill the field; the user adds arguments and hits send.
                    text = picked.fillText
                    focused = true
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            if let voiceError = voice.errorText {
                Text(voiceError)
                    .font(.caption2)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
            }
            if let attachmentError {
                Text(attachmentError)
                    .font(.caption2)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
            }

            HStack(alignment: .bottom, spacing: 10) {
                leadingControl

                // The glass is a background layer so the text and the solid
                // send button sit ON TOP at full contrast, rather than as
                // glass content (which the material desaturates). Bottom
                // alignment anchors the send button to the lower-right as the
                // field grows (the iMessage behavior); a constant corner radius
                // (half the collapsed height) keeps it a capsule when short and
                // a same-radius rounded rect when it expands, instead of a
                // ballooning stadium. `minHeight` floors it to one row.
                VStack(alignment: .leading, spacing: 0) {
                    if !chat.attachments.isEmpty {
                        attachmentsStrip
                            .padding(.horizontal, 12)
                            .padding(.top, 10)
                            .padding(.bottom, 2)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }

                    ZStack {
                        // The typing row stays mounted (just hidden) while
                        // recording so the text field keeps first responder and
                        // its caret — letting a finished transcript splice in
                        // exactly where the user left off.
                        HStack(alignment: .bottom, spacing: 6) {
                            PasteAwareComposerTextView(
                                text: $text,
                                isFocused: Binding(
                                    get: { focused },
                                    set: { focused = $0 }
                                ),
                                placeholder: "Message Graft",
                                controller: textController,
                                height: $editorHeight,
                                acceptsHeightMeasurements: !recordingActive,
                                additionalChromeHeight: attachmentChromeHeight + siblingChromeHeight
                            ) { images in
                                appendAttachments(for: images)
                            }
                            .accessibilityIdentifier("chat-composer-text-view ph-no-capture")
                            // While dictation runs, the hidden editor must not
                            // prop the capsule open at its grown draft height —
                            // the waveform reads against the collapsed pill
                            // (`minHeight` floors the capsule). Only the layout
                            // height collapses; the view stays mounted so first
                            // responder and the caret survive, and the capsule
                            // grows back when the transcript lands and the
                            // editor re-measures.
                            .frame(
                                height: recordingActive
                                    ? 0
                                    : isExpanded
                                        ? max(editorHeight, expandedEditorMinHeight)
                                        : editorHeight
                            )
                            .padding(.top, ComposerLayout.editorVerticalPadding)
                            .padding(
                                .bottom,
                                isExpanded ? 6 : ComposerLayout.editorVerticalPadding
                            )
                            .padding(.leading, 16)
                            .padding(.trailing, isExpanded ? 16 : 0)
                            if !isExpanded {
                                trailingControl
                                    .padding(.trailing, 7)
                                    .padding(.bottom, 7)
                            }
                        }
                        .opacity(recordingActive ? 0 : 1)
                        .allowsHitTesting(!recordingActive)

                        if recordingActive {
                            recordingRow
                                .transition(.opacity)
                        }
                    }

                    // Codex-style active state: the capsule opens into a text
                    // area with attach + permissions on the left and the
                    // model/effort trigger + send controls on the right, all
                    // inside the same glass surface.
                    if isExpanded {
                        HStack(spacing: 5) {
                            composerAttachButton
                            permissionsMenu
                            Spacer(minLength: 8)
                            modelEffortTrigger
                            trailingControl
                        }
                        .padding(.horizontal, 7)
                        .padding(.bottom, 7)
                        .transition(.opacity)
                    }
                }
                .frame(minHeight: controlHeight)
                .fixedSize(horizontal: false, vertical: true)
                .background {
                    Color.clear.glassEffect(
                        .regular,
                        in: .rect(cornerRadius: controlHeight / 2, style: .continuous)
                    )
                }
                .animation(.snappy(duration: 0.2), value: canSend)
                .animation(.snappy(duration: 0.2), value: isExpanded)
                .animation(.snappy(duration: 0.2), value: chat.isStreaming)
                .animation(.snappy(duration: 0.18), value: chat.attachments.isEmpty)
                // Wrap growth (typing or a landed transcript) glides instead of
                // snapping — the collapse into dictation and the grow-back out
                // of it read as one continuous resize.
                .animation(.snappy(duration: 0.2), value: editorHeight)
            }
            .padding(.horizontal, 12)
            .animation(.snappy(duration: 0.2), value: recordingActive)
        }
        // SwiftUI's keyboard safe area already positions this inset above the
        // software keyboard on iOS 26 and 27. Keep one design-system spacing
        // unit between the floating glass controls and the keyboard chrome.
        .padding(.bottom, DS.Space.s1)
        .task { await app.loadModelsIfNeeded() }
        .photosPicker(isPresented: $showPhotos, selection: $photoItems,
                      maxSelectionCount: 4, matching: .images)
        .fileImporter(
            isPresented: $showFiles,
            allowedContentTypes: [.image],
            allowsMultipleSelection: true
        ) { result in
            if case let .success(urls) = result {
                Task { await loadAttachments(from: urls) }
            }
        }
        .sheet(isPresented: $showCamera) {
            CameraPicker { image in
                Task { await loadAttachment(from: image) }
            }
            .ignoresSafeArea()
        }
        .sheet(isPresented: $showModelSheet) {
            ModelPickerSheet(chat: chat)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(DS.Radius.xl)
        }
        .onChange(of: photoItems) {
            guard !photoItems.isEmpty else { return }
            let items = photoItems
            photoItems = []
            Task {
                for item in items { await loadAttachment(from: item) }
            }
        }
        .onChange(of: text) {
            slash.update(query: text, app: app)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active, voice.isRecording {
                voice.cancel()
            }
        }
        .onDisappear {
            if voice.isRecording {
                voice.cancel()
            }
        }
        .onDrop(of: [.image], isTargeted: $isDropTargeted) { providers in
            loadAttachments(from: providers)
            focused = true
            return true
        }
        .overlay {
            if isDropTargeted {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(Theme.bubble.opacity(0.55), lineWidth: 2)
                    .padding(.horizontal, 10)
                    .allowsHitTesting(false)
            }
        }
        .animation(.snappy(duration: 0.18), value: slash.items)
        .animation(.snappy(duration: 0.16), value: isDropTargeted)
    }

    // MARK: Leading control

    /// The leading glass button morphs between the attach "+" (idle) and an
    /// ✕ that discards an in-progress recording — same footprint, so the swap
    /// reads as one button changing role rather than two buttons trading places.
    @ViewBuilder
    private var leadingControl: some View {
        if recordingActive {
            cancelButton
                .transition(.scale.combined(with: .opacity))
        } else if Self.attachmentsSupported {
            attachButton
                .transition(.scale.combined(with: .opacity))
        }
    }

    /// The Graft turn protocol is text-only today; the attach entry point
    /// hides (instead of collecting images that could never be sent) until
    /// the host accepts attachments.
    static let attachmentsSupported = false

    private var cancelButton: some View {
        Button {
            voice.cancel()
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: controlHeight, height: controlHeight)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        // Once we've committed to transcribing there's nothing left to abort.
        .disabled(voice.phase == .transcribing)
        .accessibilityLabel("Cancel recording")
    }

    // MARK: Attach popover

    /// Glass "+" that opens a popover of attachment sources, rather than
    /// dropping straight into the full-screen photo drawer.
    private var attachButton: some View {
        Menu {
            attachMenuItems
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(.primary)
                .frame(width: controlHeight, height: controlHeight)
                .contentShape(.circle)
        }
        .glassEffect(.regular.interactive(), in: .circle)
    }

    @ViewBuilder
    private var attachMenuItems: some View {
        Button {
            showPhotos = true
        } label: {
            Label("Photos", systemImage: "photo.on.rectangle")
        }
        Button {
            openCamera()
        } label: {
            Label("Camera", systemImage: "camera")
        }
        Button {
            showFiles = true
        } label: {
            Label("Files", systemImage: "folder")
        }
        Button {
            pasteAttachmentsFromClipboard()
        } label: {
            Label("Paste", systemImage: "doc.on.clipboard")
        }
    }

    /// In-card "+" on the controls row, mirroring the desktop composer's plus
    /// menu placement (Codex anatomy: attach and permissions bottom-left).
    private var composerAttachButton: some View {
        Menu {
            attachMenuItems
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(.primary)
                .frame(width: 32, height: 32)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add attachment")
    }

    // MARK: Permissions

    /// Menu for the thread's approval policy, labeled with the current policy
    /// name. The first catalog entry is the provider's baseline; anything else
    /// grants the agent more autonomy and earns the warning tint.
    @ViewBuilder
    private var permissionsMenu: some View {
        let options = app.approvalPolicyOptions(forThread: chat.threadId)
        if !options.isEmpty {
            let current = app.currentApprovalPolicy(forThread: chat.threadId)
                ?? options.first?.value
            let elevated = current != options.first?.value
            let currentLabel = options.first { $0.value == current }?.label
                ?? "Permissions"
            let label = Text(currentLabel)
                .font(.footnote.weight(.medium))
                .foregroundStyle(elevated ? Color.orange : Color.secondary)
                .lineLimit(1)
                .padding(.horizontal, 8)
                .frame(height: 32)
                .contentShape(.capsule)
            if options.count <= 1 {
                label
                    .accessibilityLabel("Permissions")
            } else {
                Menu {
                    ForEach(options) { option in
                        Button {
                            Task {
                                _ = await app.setThreadApproval(
                                    threadId: chat.threadId,
                                    policy: option.value
                                )
                            }
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
                                if option.value == current {
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
    }

    // MARK: Model switcher

    /// True when the composer shows its opened, Codex-style card: text area on
    /// top, model switcher + send controls on a row of their own beneath it.
    private var isExpanded: Bool {
        (focused || canSend) && !recordingActive
    }

    /// The thread's current model, resolved against the host's catalog.
    private var currentModel: ModelOption? {
        app.currentModel(forThread: chat.threadId)
    }

    /// Combined model + effort readout, Codex-style: "Opus 4.8 High" with the
    /// model in ink and the effort in a muted step. Opens the picker sheet.
    private var modelEffortTrigger: some View {
        Button {
            showModelSheet = true
        } label: {
            HStack(spacing: 4) {
                Text(currentModel?.label ?? "Model")
                    .foregroundStyle(.primary)
                if let effort = app.resolvedEffort(forThread: chat.threadId) {
                    Text(Self.effortDisplayName(effort))
                        .foregroundStyle(.secondary)
                }
            }
            .font(.footnote.weight(.medium))
            .lineLimit(1)
            .padding(.horizontal, 8)
            .frame(height: 32)
            .contentShape(.capsule)
        }
        .buttonStyle(PressableButtonStyle())
        .disabled(app.availableModels.isEmpty && currentModel == nil)
        .accessibilityLabel("Model and reasoning effort")
    }

    /// Mirror of the desktop's effort labels (formatReasoningEffort). Shared
    /// with `ModelPickerSheet`.
    static func effortDisplayName(_ value: String) -> String {
        switch value {
        case "xhigh": return "Extra High"
        case "none", "off": return "Off"
        default:
            return value
                .replacingOccurrences(of: "-", with: " ")
                .replacingOccurrences(of: "_", with: " ")
                .capitalized
        }
    }

    // MARK: Trailing control

    /// Morphs in place. Streaming with no draft is the lone stop button;
    /// otherwise the mic always sits to the left (it works with or without a
    /// draft now), and the solid trailing control swaps send (draft) ↔ live
    /// mode (empty). The mic is the one constant, so it holds its position as
    /// the neighbour changes rather than sliding around.
    @ViewBuilder
    private var trailingControl: some View {
        if chat.isStreaming && !canSend {
            filledCircle(icon: "stop.fill") { Task { await chat.interrupt() } }
                .transition(.scale.combined(with: .opacity))
        } else {
            HStack(spacing: 5) {
                // Recording while a reply streams in would fight the same audio
                // session, so the mic steps aside until the stream settles. Its
                // slot becomes the stop button instead — otherwise stopping a
                // reply while holding a draft required clearing the field first.
                if chat.isStreaming {
                    streamingStopButton
                } else {
                    micButton
                }
                if canSend {
                    filledCircle(icon: "arrow.up") { send() }
                        .transition(.scale.combined(with: .opacity))
                } else if let onStartLiveMode {
                    filledCircle(icon: "waveform", action: onStartLiveMode)
                        .accessibilityLabel("Start live mode")
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .transition(.scale.combined(with: .opacity))
        }
    }

    private var streamingStopButton: some View {
        Button {
            Task { await chat.interrupt() }
        } label: {
            Image(systemName: "stop.fill")
                .font(.system(size: 16))
                .foregroundStyle(.secondary)
                .frame(width: 32, height: 32)
                .contentShape(.circle)
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityLabel("Stop generating")
    }

    private var micButton: some View {
        Button {
            Task { await startRecording() }
        } label: {
            Image(systemName: "mic")
                .font(.system(size: 18))
                .foregroundStyle(.secondary)
                .frame(width: 32, height: 32)
                .contentShape(.circle)
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityLabel("Dictate")
    }

    private func filledCircle(icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.bubbleText)
                .frame(width: 32, height: 32)
                .background(Theme.bubble, in: .circle)
        }
        .buttonStyle(PressableButtonStyle())
    }

    private var attachmentsStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(chat.attachments) { attachment in
                    Image(uiImage: attachment.thumbnail)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 56, height: 56)
                        .clipShape(.rect(cornerRadius: 10))
                        .overlay(alignment: .topTrailing) {
                            Button {
                                chat.attachments.removeAll { $0.id == attachment.id }
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.caption)
                                    .foregroundStyle(.white, .black.opacity(0.6))
                            }
                            .padding(2)
                        }
                }
            }
        }
        .frame(height: ComposerLayout.attachmentStripHeight)
    }

    // MARK: Recording

    /// True while the capsule is showing the dictation UI — actively recording
    /// or finishing the transcription. Drives the leading ✕, the hidden typing
    /// row, and the waveform overlay.
    private var recordingActive: Bool {
        voice.isRecording || voice.phase == .transcribing
    }

    /// Fills the capsule while recording: a live scrolling waveform, then a
    /// secondary stop (fills the field for review) and a primary send
    /// (transcribes and fires the message). Collapses to a transcribing
    /// indicator once either is tapped.
    @ViewBuilder
    private var recordingRow: some View {
        HStack(spacing: 8) {
            if voice.phase == .transcribing {
                ProgressView()
                    .controlSize(.small)
                    .padding(.leading, 2)
                Text("Transcribing…")
                    .font(DS.Font.callout)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
            } else {
                // `RecordingWaveform` observes `voice.levelHistory` directly, so
                // the ~30fps sampling re-renders only the Canvas, not the whole
                // glass composer.
                RecordingWaveform(voice: voice)
                    .frame(maxWidth: .infinity)
                    .frame(height: 22)
                stopButton
                sendRecordingButton
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 7)
        .padding(.vertical, 7)
        .frame(minHeight: controlHeight)
    }

    /// Secondary action: stop and drop the transcript into the field to edit.
    private var stopButton: some View {
        Button {
            Task { await finishRecording(send: false) }
        } label: {
            Image(systemName: "stop.fill")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.primary)
                .frame(width: 32, height: 32)
                .background(Color.primary.opacity(0.09), in: .circle)
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityLabel("Stop and review")
    }

    /// Primary action: stop, transcribe, and send the message automatically.
    private var sendRecordingButton: some View {
        filledCircle(icon: "arrow.up") {
            Task { await finishRecording(send: true) }
        }
        .accessibilityLabel("Send dictation")
    }

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !chat.attachments.isEmpty
    }

    // MARK: Actions

    private func send() {
        let message = text
        guard canSend else { return }
        attachmentError = nil
        text = ""
        Task {
            let accepted = await chat.send(message)
            // A rejected send (e.g. agent offline) must never eat the draft —
            // restore it unless the user has already started typing again.
            if !accepted, text.isEmpty {
                text = message
            }
        }
    }

    private func openCamera() {
        attachmentError = nil
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            attachmentError = "Camera is unavailable on this device."
            return
        }
        guard Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription") != nil else {
            attachmentError = "Missing privacy setting: NSCameraUsageDescription."
            return
        }
        showCamera = true
    }

    private func startRecording() async {
        attachmentError = nil
        await voice.start(useServer: app.settings.useServerTranscription)
        // Confirm capture began with a light tap — only once recording is truly
        // live (not on a permission denial or failure), so the haptic always
        // means "listening now."
        if voice.phase == .recording {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }

    /// Ends a recording. The transcript is spliced in at the caret (matching how
    /// typing it would land); `send` then fires it as a message automatically,
    /// while stop leaves it in the field for the user to review and edit.
    private func finishRecording(send shouldSend: Bool) async {
        let transcript = await voice.stop(rest: nil)  // on-device transcription only; no host STT endpoint yet
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            textController.insert(trimmed)
        }
        if shouldSend {
            send()
        } else if !trimmed.isEmpty {
            focused = true
        }
    }

    private func loadAttachment(from item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data)
        else { return }
        appendAttachment(for: image)
    }

    private func loadAttachments(from urls: [URL]) async {
        for url in urls {
            // Picked files live outside the sandbox until we open a scope.
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url),
                  let image = UIImage(data: data)
            else { continue }
            appendAttachment(for: image)
        }
    }

    private func loadAttachments(from providers: [NSItemProvider]) {
        attachmentError = nil
        var foundImageProvider = false

        for provider in providers where provider.canLoadObject(ofClass: UIImage.self) {
            foundImageProvider = true
            provider.loadObject(ofClass: UIImage.self) { object, _ in
                guard let image = object as? UIImage else {
                    Task { @MainActor in
                        attachmentError = "Couldn't load that image."
                    }
                    return
                }
                Task { @MainActor in
                    appendAttachment(for: image)
                    focused = true
                }
            }
        }

        if !foundImageProvider {
            attachmentError = "That item isn't an image."
        }
    }

    private func loadAttachment(from image: UIImage) async {
        appendAttachment(for: image)
    }

    private func appendAttachments(for images: [UIImage]) {
        guard !images.isEmpty else { return }
        attachmentError = nil
        for image in images {
            appendAttachment(for: image)
        }
        focused = true
    }

    private func pasteAttachmentsFromClipboard() {
        attachmentError = nil
        let images = UIPasteboard.general.images ?? []
        guard !images.isEmpty else {
            attachmentError = "Clipboard doesn't contain an image."
            return
        }
        appendAttachments(for: images)
    }

    /// Re-encode as JPEG (handles HEIC) and bound the long edge to keep upload
    /// sizes sane for vision models, then attach with a small thumbnail.
    private func appendAttachment(for image: UIImage) {
        attachmentError = nil
        let bounded = image.boundedToLongEdge(2048)
        guard let jpeg = bounded.jpegData(compressionQuality: 0.85) else { return }
        let thumbnail = image.boundedToLongEdge(112)
        chat.attachments.append(PendingAttachment(jpegData: jpeg, thumbnail: thumbnail))
    }
}

/// Imperative bridge to the composer's `UITextView` so a finished voice
/// transcript lands at the caret (replacing any selection), exactly as a typed
/// insertion would, instead of always being appended at the end. Held as
/// `@State` by the composer and handed to the text view, which keeps the weak
/// reference current.
@MainActor
final class ComposerTextController {
    weak var textView: UITextView?

    /// Inserts `string` at the caret, padding it with single spaces only where
    /// it would otherwise fuse with a neighbouring word. Falls back to appending
    /// when the field has no live caret (e.g. it was never focused).
    func insert(_ string: String) {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let textView else { return }
        guard let range = textView.selectedTextRange else {
            let existing = textView.text ?? ""
            textView.text = existing.isEmpty ? trimmed : existing + " " + trimmed
            textView.delegate?.textViewDidChange?(textView)
            return
        }
        // `replace` leaves the caret just after the inserted run, so the user
        // can keep going from there.
        textView.replace(range, withText: padded(trimmed, around: range, in: textView))
        textView.delegate?.textViewDidChange?(textView)
    }

    private func padded(_ text: String, around range: UITextRange, in textView: UITextView) -> String {
        var result = text
        if let before = textView.position(from: range.start, offset: -1),
           let r = textView.textRange(from: before, to: range.start),
           let neighbour = textView.text(in: r),
           let last = neighbour.last, !last.isWhitespace {
            result = " " + result
        }
        if let after = textView.position(from: range.end, offset: 1),
           let r = textView.textRange(from: range.end, to: after),
           let neighbour = textView.text(in: r),
           let first = neighbour.first, !first.isWhitespace {
            result += " "
        }
        return result
    }
}

/// A live, scrolling history of microphone levels — the ChatGPT dictation
/// readout. Bars come straight from `VoiceModel.levelHistory` (sampled off the
/// real audio meter), newest at the trailing edge marching left; silence reads
/// as a centred row of dots, speech as taller bars. Monochrome to match the
/// design system's register.
private struct RecordingWaveform: View {
    var voice: VoiceModel

    var body: some View {
        // Read in `body` (not just the Canvas closure) so the observation
        // dependency is registered and the Canvas redraws as new levels arrive.
        let samples = voice.levelHistory
        Canvas { context, size in
            let count = max(samples.count, 1)
            let pitch = size.width / CGFloat(count)
            // Thin capsule bars that nearly fill their slot — the dense, fine
            // ChatGPT/Whisper trace, not a few chunky bars with wide gaps.
            let barWidth = min(2, max(1, pitch * 0.7))
            let midY = size.height / 2
            for (index, level) in samples.enumerated() {
                // `level` is an already-shaped per-slice peak (0…1); a touch of
                // headroom lets normal speech reach full height while quiet stays
                // a small dot. A flat read means there's genuinely no input
                // (e.g. the Simulator, which has no microphone).
                let amplitude = min(1, level * 1.15)
                let x = pitch * CGFloat(index) + (pitch - barWidth) / 2
                let height = max(barWidth, amplitude * size.height)
                let rect = CGRect(x: x, y: midY - height / 2, width: barWidth, height: height)
                // Older samples (left) fade out; the live edge (right) is full ink.
                let recency = CGFloat(index) / CGFloat(max(1, count - 1))
                let opacity = 0.2 + 0.8 * recency
                context.fill(
                    Path(roundedRect: rect, cornerRadius: barWidth / 2),
                    with: .color(DS.Color.fg.opacity(Double(opacity)))
                )
            }
        }
        // Soften the trailing (right) edge so new bars emerge from a gentle fade
        // rather than a hard vertical cut against the stop button.
        .mask(
            LinearGradient(
                stops: [
                    .init(color: .black, location: 0),
                    .init(color: .black, location: 0.9),
                    .init(color: .black.opacity(0), location: 1)
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
        )
        .accessibilityHidden(true)
    }
}

/// UIKit-backed text input so the iOS paste action can intercept images.
/// SwiftUI's paste-command modifier is not available on iOS, and the stock
/// text field only handles textual paste payloads.
private struct PasteAwareComposerTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool
    let placeholder: String
    let controller: ComposerTextController
    @Binding var height: CGFloat
    /// Dictation keeps the UIKit text view mounted while SwiftUI collapses the
    /// visible row. During that hidden state UIKit can report a one-line/zero-
    /// frame measurement; do not let that transient layout overwrite the saved
    /// draft height that should be restored when dictation finishes.
    let acceptsHeightMeasurements: Bool
    /// Height inside the composer that is not part of the editor itself. The
    /// attachment strip is 56pt with 12pt of vertical padding.
    let additionalChromeHeight: CGFloat
    let onPasteImages: ([UIImage]) -> Void

    func makeUIView(context: Context) -> ComposerUITextView {
        let textView = ComposerUITextView()
        textView.delegate = context.coordinator
        textView.placeholder = placeholder
        textView.accessibilityIdentifier = "chat-composer-text-view ph-no-capture"
        textView.onPasteImages = onPasteImages
        textView.onLayoutChange = { [weak coordinator = context.coordinator] textView in
            coordinator?.scheduleHeightUpdate(for: textView)
        }
        controller.textView = textView
        return textView
    }

    func updateUIView(_ textView: ComposerUITextView, context: Context) {
        let chromeHeightChanged = context.coordinator.parent.additionalChromeHeight
            != additionalChromeHeight
        context.coordinator.parent = self
        textView.placeholder = placeholder
        textView.onPasteImages = onPasteImages
        textView.onLayoutChange = { [weak coordinator = context.coordinator] textView in
            coordinator?.scheduleHeightUpdate(for: textView)
        }
        controller.textView = textView

        if textView.text != text {
            textView.text = text
            textView.updatePlaceholderVisibility()
            context.coordinator.scheduleHeightUpdate(for: textView)
        } else if chromeHeightChanged {
            context.coordinator.scheduleHeightUpdate(for: textView)
        }
        // UIKit owns resignation. SwiftUI updates can momentarily lag the
        // delegate focus callback while the composer swaps trailing controls.
        if isFocused, !textView.isFirstResponder {
            textView.becomeFirstResponder()
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: PasteAwareComposerTextView

        init(parent: PasteAwareComposerTextView) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            (textView as? ComposerUITextView)?.updatePlaceholderVisibility()
            updateHeight(for: textView)
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            parent.isFocused = true
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            parent.isFocused = false
        }

        /// Programmatic changes happen during `updateUIView`; defer their
        /// binding write until that update completes. Width changes use the
        /// same path after UIKit has laid out the new bounds.
        func scheduleHeightUpdate(for textView: UITextView) {
            Task { @MainActor [weak self, weak textView] in
                guard let self, let textView else { return }
                updateHeight(for: textView)
            }
        }

        private func updateHeight(for textView: UITextView) {
            let width = textView.bounds.width
            guard width > 0 else { return }

            let measuredHeight = textView.sizeThatFits(
                CGSize(width: width, height: CGFloat.greatestFiniteMagnitude)
            ).height
            let lineHeight = textView.font?.lineHeight
                ?? UIFont.systemFont(ofSize: 16).lineHeight
            let minimumHeight = ceil(lineHeight)
            let maximumHeight = maximumEditorHeight(
                for: textView,
                minimumHeight: minimumHeight
            )
            let resolvedHeight = min(
                max(ceil(measuredHeight), minimumHeight),
                maximumHeight
            )

            guard parent.acceptsHeightMeasurements else { return }

            let shouldScroll = measuredHeight > maximumHeight
            if textView.isScrollEnabled != shouldScroll {
                textView.isScrollEnabled = shouldScroll
            }
            if shouldScroll {
                textView.scrollRangeToVisible(textView.selectedRange)
            }
            let resolvedBindingHeight = ComposerTextHeightPolicy.resolvedBindingHeight(
                currentHeight: parent.height,
                measuredHeight: resolvedHeight,
                maximumHeight: maximumHeight,
                acceptsMeasurements: parent.acceptsHeightMeasurements
            )
            if abs(parent.height - resolvedBindingHeight) > 0.5 {
                parent.height = resolvedBindingHeight
            }
        }

        /// Messages-style drafts grow into the usable space above the keyboard
        /// instead of stopping after an arbitrary line count. Measuring from
        /// the editor's actual bottom edge lets SwiftUI's native keyboard-safe-
        /// area placement define the limit, so it remains correct in landscape,
        /// multitasking, and across the iOS 26/27 keyboard geometries. Once the
        /// editor reaches that cap, UIKit scrolls the text and keeps the caret
        /// visible.
        private func maximumEditorHeight(
            for textView: UITextView,
            minimumHeight: CGFloat
        ) -> CGFloat {
            guard let window = textView.window else {
                return ceil(minimumHeight * 6)
            }

            let editorFrame = textView.convert(textView.bounds, to: window)
            let restingEditorBottom = window.bounds.maxY
                - window.safeAreaInsets.bottom
                - ComposerLayout.editorVerticalPadding
                - DS.Space.s1
            let keyboardLift = restingEditorBottom - editorFrame.maxY
            let keyboardIsVisible = keyboardLift > DS.Space.s10

            // Keep the expanded glass below the app's floating top bar. The
            // editor has 13pt of top padding inside that glass, so its own top
            // edge needs the same extra clearance. Attachment thumbnails live
            // above the editor and consume their measured 68pt as well.
            let editorTopBoundary = window.safeAreaInsets.top
                + DS.Space.s8
                + ComposerLayout.editorVerticalPadding
            let availableHeight = editorFrame.maxY
                - editorTopBoundary
                - parent.additionalChromeHeight

            // With the keyboard dismissed, retain the familiar composer shape
            // instead of allowing a draft to consume the entire screen. The
            // keyboard-visible path is normally constrained by available space.
            let proportionalLimit = window.bounds.height * (keyboardIsVisible ? 0.46 : 0.52)
            return max(
                minimumHeight,
                floor(min(availableHeight, proportionalLimit))
            )
        }
    }
}

enum ComposerTextHeightPolicy {
    static func resolvedBindingHeight(
        currentHeight: CGFloat,
        measuredHeight: CGFloat,
        maximumHeight: CGFloat,
        acceptsMeasurements: Bool
    ) -> CGFloat {
        guard acceptsMeasurements else { return currentHeight }
        return min(measuredHeight, maximumHeight)
    }
}

private final class ComposerUITextView: UITextView {
    var placeholder = "" {
        didSet {
            placeholderLabel.text = placeholder
            accessibilityLabel = placeholder
            updatePlaceholderVisibility()
        }
    }
    var onPasteImages: (([UIImage]) -> Void)?
    var onLayoutChange: ((ComposerUITextView) -> Void)?

    private let placeholderLabel = UILabel()
    private var lastReportedWidth: CGFloat = 0
    private var lastReportedWindowBottom: CGFloat = 0

    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        configure()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override var text: String! {
        didSet { updatePlaceholderVisibility() }
    }

    override var attributedText: NSAttributedString! {
        didSet { updatePlaceholderVisibility() }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let windowBottom = window.map { convert(bounds, to: $0).maxY } ?? 0
        guard abs(bounds.width - lastReportedWidth) > 0.5
                || abs(windowBottom - lastReportedWindowBottom) > 0.5
        else { return }
        lastReportedWidth = bounds.width
        lastReportedWindowBottom = windowBottom
        onLayoutChange?(self)
    }

    /// A plain-text `UITextView` reports it *cannot* paste when the clipboard
    /// holds only an image, so the system never offers "Paste" (and ⌘V is a
    /// no-op) — meaning the `paste(_:)` override below never runs. Surface the
    /// action ourselves whenever the pasteboard has images; `paste(_:)` then
    /// routes them to attachments. `hasImages` is a lightweight presence check
    /// that, unlike reading `.images`, doesn't trip the paste-access banner.
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(paste(_:)), Self.pasteboardContainsImages(UIPasteboard.general) {
            return true
        }
        return super.canPerformAction(action, withSender: sender)
    }

    override func canPaste(_ itemProviders: [NSItemProvider]) -> Bool {
        if itemProviders.contains(where: Self.isImageProvider) {
            return true
        }
        return super.canPaste(itemProviders)
    }

    override func paste(_ sender: Any?) {
        let pasteboard = UIPasteboard.general
        let images = pasteboard.images ?? []
        if !images.isEmpty {
            onPasteImages?(images)
            if pasteboard.string == nil {
                return
            }
        }
        super.paste(sender)
    }

    override func paste(itemProviders: [NSItemProvider]) {
        let imageProviders = itemProviders.filter(Self.isImageProvider)
        let otherProviders = itemProviders.filter { !Self.isImageProvider($0) }

        if !imageProviders.isEmpty {
            loadImages(from: imageProviders)
        }
        if !otherProviders.isEmpty {
            super.paste(itemProviders: otherProviders)
        }
    }

    func updatePlaceholderVisibility() {
        placeholderLabel.isHidden = !text.isEmpty
    }

    private func configure() {
        backgroundColor = .clear
        isScrollEnabled = false
        showsVerticalScrollIndicator = false
        textContainerInset = .zero
        textContainer.lineFragmentPadding = 0
        font = .systemFont(ofSize: 16, weight: .regular)
        textColor = .label
        tintColor = .label
        adjustsFontForContentSizeCategory = true
        isAccessibilityElement = true
        accessibilityLabel = placeholder
        // Natural-language composer: defer to the system keyboard so the user's
        // own autocorrect, spelling, smart-punctuation, prediction, and Writing
        // Tools settings apply on every supported runtime.
        autocorrectionType = .default
        spellCheckingType = .default
        smartQuotesType = .default
        smartDashesType = .default
        smartInsertDeleteType = .default
        autocapitalizationType = .sentences
        if #available(iOS 17.0, *) {
            inlinePredictionType = .default
        }
#if targetEnvironment(simulator)
        // Current simulator runtimes ship duplicate proofreading classes
        // and can abort while their grammar shimmer targets a UITextView subclass.
        // Devices keep the user's normal spelling and Writing Tools behavior.
        spellCheckingType = .no
        writingToolsBehavior = .none
#endif
        returnKeyType = .default
        keyboardDismissMode = .interactive
        setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let pasteConfig = UIPasteConfiguration(forAccepting: UIImage.self)
        pasteConfig.addTypeIdentifiers(forAccepting: String.self)
        pasteConfiguration = pasteConfig

        placeholderLabel.font = font
        placeholderLabel.textColor = .placeholderText
        placeholderLabel.translatesAutoresizingMaskIntoConstraints = false
        placeholderLabel.isUserInteractionEnabled = false
        addSubview(placeholderLabel)
        NSLayoutConstraint.activate([
            placeholderLabel.leadingAnchor.constraint(equalTo: leadingAnchor),
            placeholderLabel.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor),
            placeholderLabel.topAnchor.constraint(equalTo: topAnchor),
        ])
    }

    private func loadImages(from providers: [NSItemProvider]) {
        for provider in providers {
            provider.loadObject(ofClass: UIImage.self) { [weak self] object, _ in
                guard let image = object as? UIImage else { return }
                Task { @MainActor [weak self] in
                    self?.onPasteImages?([image])
                }
            }
        }
    }

    private static func pasteboardContainsImages(_ pasteboard: UIPasteboard) -> Bool {
        if pasteboard.hasImages {
            return true
        }
        return pasteboard.itemProviders.contains(where: isImageProvider)
    }

    private static func isImageProvider(_ provider: NSItemProvider) -> Bool {
        provider.canLoadObject(ofClass: UIImage.self)
            || provider.hasItemConformingToTypeIdentifier(UTType.image.identifier)
    }
}

/// Thin wrapper over `UIImagePickerController` in camera mode — SwiftUI has no
/// native live-camera capture, so this bridges one shot back as a `UIImage`.
private struct CameraPicker: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage {
                parent.onCapture(image)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

private extension UIImage {
    func boundedToLongEdge(_ maxEdge: CGFloat) -> UIImage {
        let longEdge = max(size.width, size.height)
        guard longEdge > maxEdge else { return self }
        let scale = maxEdge / longEdge
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}
