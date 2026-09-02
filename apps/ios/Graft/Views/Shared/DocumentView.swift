import SwiftUI

/// Notion-like document surface. Prose (`.md`, `.txt`) opens **rendered** —
/// a big page title, generous margins, formatted headings/bullets/quotes via
/// `MarkdownText`, no caption box / divider / monospace. A quiet top-right
/// **Edit** flips to a clean full-bleed writing view (body font, no chrome)
/// that saves on **Done** and returns to the rendered page. Code files
/// (`.json`, `.py`, …) render as clean monospace and skip the rendered prose.
///
/// Works both pushed inside a navigation stack and presented as a sheet — pass
/// `isModal: true` for the sheet case to get a leading close button. When
/// `save` is `nil` the document is read-only (no Edit affordance).
struct DocumentView: View {
    let title: String
    /// File name (or path) — only its extension is used, to pick prose vs code.
    let fileName: String
    var subtitle: String?
    var isModal = false
    let load: () async throws -> String
    var save: ((String) async throws -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var draft = ""
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var isEditing = false
    @State private var errorText: String?
    @FocusState private var editorFocused: Bool

    var body: some View {
        Group {
            if isEditing {
                editor
            } else {
                reader
            }
        }
        .background(DS.Color.bg)
        .overlay { if isLoading { ProgressView() } }
        .navigationTitle(isEditing ? title : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .task {
            do {
                text = try await load()
                draft = text
                errorText = nil
            } catch {
                errorText = error.localizedDescription
            }
            isLoading = false
        }
        .dismissKeyboardOnDisappear()
    }

    // MARK: Reader

    private var reader: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.s3) {
                titleBlock
                if let errorText {
                    Text(errorText).font(DS.Font.footnote).foregroundStyle(DS.Color.danger)
                }
                if text.isEmpty && !isLoading {
                    emptyState
                } else if isCode {
                    Text(text)
                        .font(.system(size: 15, weight: .regular).monospaced())
                        .foregroundStyle(DS.Color.fg)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    MarkdownText(text)
                        .font(DS.Font.body)
                        .foregroundStyle(DS.Color.fgMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, DS.Space.s3)
            .padding(.top, DS.Space.s2)
            .padding(.bottom, DS.Space.s10)
        }
        .scrollEdgeEffectStyle(.soft, for: .all)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: DS.Space.half) {
            Text(title)
                .font(DS.Font.title1)
                .tracking(DS.Tracking.display)
                .foregroundStyle(DS.Color.fg)
            if let subtitle {
                Text(subtitle)
                    .font(DS.Font.footnote)
                    .foregroundStyle(DS.Color.fgSubtle)
            }
        }
    }

    private var emptyState: some View {
        Button {
            guard save != nil else { return }
            beginEditing()
        } label: {
            Text(save == nil ? "This file is empty." : "Empty — tap to start writing.")
                .font(DS.Font.body)
                .foregroundStyle(DS.Color.fgSubtle)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .disabled(save == nil)
    }

    // MARK: Editor

    private var editor: some View {
        VStack(alignment: .leading, spacing: DS.Space.s2) {
            titleBlock
                .padding(.horizontal, DS.Space.s3)
                .padding(.top, DS.Space.s2)
            TextEditor(text: $draft)
                .font(isCode ? .system(size: 15).monospaced() : DS.Font.body)
                .foregroundStyle(DS.Color.fg)
                .scrollContentBackground(.hidden)
                .focused($editorFocused)
                .padding(.horizontal, DS.Space.s3 - 5) // TextEditor adds ~5px inset
            if let errorText {
                Text(errorText)
                    .font(DS.Font.footnote)
                    .foregroundStyle(DS.Color.danger)
                    .padding(.horizontal, DS.Space.s3)
                    .padding(.bottom, DS.Space.s1)
            }
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            if isEditing {
                Button("Cancel") {
                    draft = text
                    isEditing = false
                    editorFocused = false
                }
                .disabled(isSaving)
            } else if isModal {
                Button {
                    KeyboardDismissal.dismiss()
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(DS.Color.fg)
                }
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            if isEditing {
                Button {
                    Task { await commit() }
                } label: {
                    if isSaving { ProgressView() } else { Text("Done").fontWeight(.semibold) }
                }
                .disabled(isSaving)
            } else if save != nil {
                Button("Edit") { beginEditing() }
                    .disabled(isLoading)
            }
        }
    }

    // MARK: Actions

    private func beginEditing() {
        draft = text
        isEditing = true
        editorFocused = true
    }

    private func commit() async {
        guard let save else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await save(draft)
            text = draft
            errorText = nil
            isEditing = false
            editorFocused = false
        } catch {
            errorText = error.localizedDescription
        }
    }

    // MARK: Helpers

    private var ext: String {
        (fileName as NSString).pathExtension.lowercased()
    }

    /// Code files render (and edit) as monospace; everything else is prose.
    private var isCode: Bool {
        let codeExts: Set<String> = [
            "json", "js", "ts", "jsx", "tsx", "py", "swift", "sh", "bash", "zsh",
            "yaml", "yml", "toml", "rb", "go", "rs", "c", "cpp", "cc", "h", "hpp",
            "java", "kt", "html", "css", "scss", "xml", "sql", "lua", "php", "pl",
        ]
        return codeExts.contains(ext)
    }
}
