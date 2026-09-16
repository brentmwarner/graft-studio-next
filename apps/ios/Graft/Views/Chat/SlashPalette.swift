import SwiftUI

/// The host resolves commands and enabled skills for this thread's provider.
@MainActor
@Observable
final class SlashCompleter {
    private(set) var items: [ComposerCommand] = []
    private(set) var isLoading = false
    private(set) var error: String?
    private var catalog: [ComposerCommand]?
    private var loadedAt: Date?
    private var query: String?
    private var contextKey = ""
    private var generation = 0
    private var loadTask: Task<Void, Never>?
    private var failedAttempt = false
    private let now: () -> Date

    init(now: @escaping () -> Date = Date.init) {
        self.now = now
    }

    static func searchTerm(_ draft: String) -> String? {
        guard draft.hasPrefix("/"), !draft.contains(where: \.isWhitespace) else { return nil }
        return String(draft.dropFirst()).lowercased()
    }

    /// Discovery starts when the connected composer appears, before typing `/`.
    func prefetch(
        contextKey: String,
        load: @escaping @MainActor () async throws -> [ComposerCommand]
    ) {
        prepareContext(contextKey)
        failedAttempt = false
        loadIfNeeded(load)
    }

    func update(
        query draft: String,
        contextKey: String,
        load: @escaping @MainActor () async throws -> [ComposerCommand]
    ) {
        prepareContext(contextKey)
        let wasSearching = query != nil
        query = Self.searchTerm(draft)
        filterItems()
        guard query != nil else {
            // Closing the palette must not discard or cancel discovery.
            error = nil
            failedAttempt = false
            return
        }
        if !wasSearching { error = nil; failedAttempt = false }
        loadIfNeeded(load)
    }

    private func prepareContext(_ key: String) {
        guard contextKey != key else { return }
        clear()
        contextKey = key
    }

    private func loadIfNeeded(_ load: @escaping @MainActor () async throws -> [ComposerCommand]) {
        guard loadTask == nil, !failedAttempt else { return }
        // Like desktop, show cached results immediately while refreshing a
        // catalog older than 30 seconds. Typing only filters in memory.
        if let loadedAt, now().timeIntervalSince(loadedAt) < 30 { return }
        isLoading = true
        error = nil
        let requestGeneration = generation
        loadTask = Task { [weak self] in
            do {
                let commands = try await load()
                guard let self, self.generation == requestGeneration else { return }
                self.catalog = commands
                self.loadedAt = self.now()
                self.filterItems()
                self.isLoading = false
                self.loadTask = nil
            } catch {
                guard let self, self.generation == requestGeneration else { return }
                self.isLoading = false
                self.loadTask = nil
                self.failedAttempt = true
                if self.query != nil, self.catalog == nil {
                    self.error = "Commands could not load. Reopen / to retry."
                }
            }
        }
    }

    private func filterItems() {
        guard let query else { items = []; return }
        items = (catalog ?? []).filter {
            query.isEmpty || $0.name.localizedCaseInsensitiveContains(query)
                || $0.skillLabel.localizedCaseInsensitiveContains(query)
                || $0.description.localizedCaseInsensitiveContains(query)
        }
    }

    func clear() {
        generation += 1
        loadTask?.cancel()
        loadTask = nil
        catalog = nil
        loadedAt = nil
        query = nil
        items = []
        error = nil
        failedAttempt = false
        isLoading = false
    }
}

/// This surface is placed in the composer's overlay, never in its layout stack.
struct SlashPalette: View {
    let completions: [ComposerCommand]
    var status: String? = nil
    var onPreview: ((ComposerCommand) -> Void)? = nil
    let onPick: (ComposerCommand) -> Void

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 2) {
                if let status {
                    Text(status)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(20)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(completions) { completion in
                    HStack(spacing: 0) {
                        Button {
                            onPick(completion)
                        } label: {
                            SlashPaletteRow(completion: completion)
                        }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("/" + completion.name + ": " + completion.description)
                        .accessibilityIdentifier("slash-command-" + completion.name)
                        .accessibilityAction { onPick(completion) }

                        if completion.kind == "skill", let onPreview {
                            Button {
                                onPreview(completion)
                            } label: {
                                Image(systemName: "info.circle")
                                    .font(.system(size: 19))
                                    .foregroundStyle(DS.Color.fgSubtle)
                                    .frame(width: 44, height: 52)
                                    .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                            .padding(.trailing, 8)
                            .accessibilityLabel("Preview " + completion.skillLabel)
                            .accessibilityIdentifier("skill-preview-" + completion.name)
                        }
                    }
                }
            }
            .padding(.vertical, 8)
        }
        .frame(maxHeight: 300)
        .fixedSize(horizontal: false, vertical: true)
        .composerGlassSurface(shape: .roundedRectangle(cornerRadius: 24), interactive: false)
        .padding(.horizontal, 12)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Slash commands")
        .accessibilityIdentifier("slash-palette")
    }
}

private struct SlashPaletteRow: View {
    let completion: ComposerCommand

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            ComposerCommandIcon(command: completion)
                .frame(width: 22, height: 22)
                .foregroundStyle(DS.Color.fgMuted)
                .padding(.top, 2)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(completion.kind == "skill" ? completion.skillLabel : "/" + completion.name)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(DS.Color.fg)
                    .lineLimit(2)
                if !completion.description.isEmpty {
                    Text(completion.description)
                        .font(.footnote)
                        .foregroundStyle(DS.Color.fgSubtle)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, 18)
        .padding(.trailing, 12)
        .padding(.vertical, 12)
        .frame(minHeight: 64)
        .contentShape(.rect)
    }
}

/// The same building-blocks artwork as desktop's SkillCubeIcon.
struct ComposerCommandIcon: View {
    let command: ComposerCommand

    var body: some View {
        switch command.kind {
        case "model": Image(systemName: "brain").resizable().scaledToFit()
        case "tasks": Image(systemName: "checklist").resizable().scaledToFit()
        default: Image("SkillIcon").resizable().scaledToFit()
        }
    }
}

struct SkillPreviewSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var preview: ComposerSkillPreview?
    @State private var error: String?
    @State private var reload = 0
    let command: ComposerCommand
    let load: () async throws -> ComposerSkillPreview
    let onUse: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(alignment: .top, spacing: 12) {
                        ComposerCommandIcon(command: command)
                            .frame(width: 28, height: 28)
                            .foregroundStyle(DS.Color.link)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(command.skillLabel).font(.title2.weight(.semibold))
                            Text(previewDescription)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    if let preview {
                        MarkdownText(Self.instructions(in: preview.contents))
                        if preview.truncated {
                            Text("Showing the beginning of this skill’s instructions.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    } else if let error {
                        Text(error).font(.subheadline).foregroundStyle(.secondary)
                        Button("Try again") { reload += 1 }
                    } else {
                        ProgressView("Loading instructions…")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
            .background(DS.Color.bg)
            .navigationTitle("Skill preview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Use skill") { onUse(); dismiss() }
                        .tint(DS.Color.link)
                }
            }
            .task(id: reload) {
                error = nil
                do { preview = try await load() }
                catch { self.error = "The skill instructions couldn’t load. Check the Studio connection and try again." }
            }
        }
    }

    private var previewDescription: String {
        guard let preview, !preview.description.isEmpty else { return command.description }
        return preview.description
    }

    static func instructions(in contents: String) -> String {
        let normalized = contents.replacingOccurrences(of: "\r\n", with: "\n")
        guard normalized.hasPrefix("---\n"),
              let end = normalized.range(of: "\n---\n", range: normalized.index(normalized.startIndex, offsetBy: 4)..<normalized.endIndex)
        else { return normalized }
        return String(normalized[end.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
