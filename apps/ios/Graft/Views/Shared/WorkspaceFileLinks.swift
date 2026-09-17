import Foundation
import SwiftUI
import UIKit

/// A file citation, not an arbitrary code token or web address. Resolution is
/// performed by Studio against this thread's workspace before it becomes a link.
struct MarkdownFileReference: Equatable, Hashable {
    let path: String
    let line: Int?

    init?(_ raw: String, inlineCode: Bool = false) {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if inlineCode {
            value = value.trimmingCharacters(in: CharacterSet(charactersIn: "\"'`"))
            guard !value.contains(where: \.isWhitespace) else { return nil }
        }
        if value.hasPrefix("file://"), let url = URL(string: value), url.isFileURL {
            value = url.path + (url.fragment.map { "#\($0)" } ?? "")
        } else if value.contains("://") { return nil }
        guard !value.isEmpty, value.count <= 4096, !value.contains("\n"), !value.contains("\0") else { return nil }
        var line: Int?
        if let range = value.range(of: #"(?::[0-9]+(?::[0-9]+)?|#L[0-9]+(?:C[0-9]+)?(?:-L?[0-9]+)?)$"#, options: .regularExpression) {
            line = Int(value[range].drop(while: { !$0.isNumber }).prefix(while: \.isNumber))
            value.removeSubrange(range)
        }
        while value.hasPrefix("./") { value.removeFirst(2) }
        let suffix = (value as NSString).pathExtension.lowercased()
        let name = (value as NSString).lastPathComponent
        let knownNames: Set<String> = ["Dockerfile", "Makefile", "LICENSE", "Gemfile", ".gitignore", ".env", ".mise.toml"]
        let extensions: Set<String> = ["md", "mdx", "txt", "swift", "m", "mm", "h", "c", "cpp", "rs", "go", "py", "rb", "java", "kt", "kts", "tsx", "jsx", "ts", "js", "mjs", "cjs", "json", "jsonc", "yaml", "yml", "toml", "xml", "html", "css", "scss", "sql", "sh", "zsh", "bash", "vue", "svelte", "lock", "plist", "entitlements", "pbxproj", "xcconfig", "graphql", "proto"]
        guard knownNames.contains(name) || extensions.contains(suffix) else { return nil }
        self.path = value
        self.line = line.flatMap { $0 > 0 ? $0 : nil }
    }

    var typeLabel: String {
        switch (path as NSString).pathExtension.lowercased() {
        case "md", "mdx": "MD"
        case "tsx", "jsx": "React"
        case "swift": "Swift"
        case "ts": "TS"
        case "js", "mjs", "cjs": "JS"
        case "json", "jsonc": "{}"
        case "py": "PY"
        default: "File"
        }
    }

    func url(resolvedPath: String) -> URL? {
        var components = URLComponents()
        components.scheme = "graft-file"
        components.host = "workspace"
        components.queryItems = [URLQueryItem(name: "path", value: resolvedPath)]
        if let line { components.queryItems?.append(URLQueryItem(name: "line", value: String(line))) }
        return components.url
    }
}

struct WorkspaceFileSelection: Identifiable, Equatable {
    let path: String
    let line: Int?
    var id: String { "\(path):\(line ?? 0)" }

    init?(url: URL) {
        guard url.scheme == "graft-file", url.host == "workspace",
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let path = parts.queryItems?.first(where: { $0.name == "path" })?.value, !path.isEmpty else { return nil }
        self.path = path
        line = parts.queryItems?.first(where: { $0.name == "line" })?.value.flatMap(Int.init)
    }
}

@MainActor
@Observable
final class WorkspaceFileLinks {
    let threadId: String
    weak var app: AppModel?
    private(set) var paths: [String: String] = [:]
    private var checked: Set<String> = []
    private var pending: Set<String> = []
    private let resolveReferences: (@MainActor ([String]) async throws -> [WorkspaceFileReference])?
    var selection: WorkspaceFileSelection?

    init(threadId: String, app: AppModel?, resolveReferences: (@MainActor ([String]) async throws -> [WorkspaceFileReference])? = nil) {
        self.threadId = threadId
        self.app = app
        self.resolveReferences = resolveReferences
    }

    func resolve(_ references: [String]) async {
        guard app != nil || resolveReferences != nil else { return }
        let missing = Array(Set(references).subtracting(checked).subtracting(pending)).sorted()
        guard !missing.isEmpty else { return }
        pending.formUnion(missing)
        defer { pending.subtract(missing) }
        for offset in stride(from: 0, to: missing.count, by: 64) {
            let batch = Array(missing[offset..<min(offset + 64, missing.count)])
            do {
                let resolved: [WorkspaceFileReference]
                if let resolveReferences { resolved = try await resolveReferences(batch) }
                else { resolved = try await app?.resolveFiles(threadId: threadId, references: batch) ?? [] }
                for reference in resolved {
                    checked.insert(reference.reference)
                    if let path = reference.path { paths[reference.reference] = path }
                }
            } catch {
                // A transient connection error doesn't turn a file into a dead
                // link or poison the resolution cache on the next appearance.
                return
            }
        }
    }

    func open(_ url: URL) -> Bool {
        guard let selected = WorkspaceFileSelection(url: url) else { return false }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        KeyboardDismissal.dismiss()
        selection = selected
        return true
    }
}

struct WorkspaceFilePresenter: ViewModifier {
    @Bindable var links: WorkspaceFileLinks

    func body(content: Content) -> some View {
        content
            .environment(links)
            .environment(\.openURL, OpenURLAction { url in
                links.open(url) ? .handled : .systemAction
            })
            .sheet(item: $links.selection) { selection in
                WorkspaceFileSheet(selection: selection, links: links)
                    .environment(links)
                    .environment(\.openURL, OpenURLAction { url in
                        links.open(url) ? .handled : .systemAction
                    })
                    .presentationBackgroundInteraction(.disabled)
            }
    }
}

private struct WorkspaceFileSheet: View {
    @Environment(\.dismiss) private var dismiss
    let selection: WorkspaceFileSelection
    let links: WorkspaceFileLinks
    @State private var file: WorkspaceFile?
    @State private var error: String?
    @State private var showSource = false

    private var isMarkdown: Bool {
        ["md", "mdx"].contains((selection.path as NSString).pathExtension.lowercased())
    }

    var body: some View {
        NavigationStack {
            Group {
                if let file {
                    WorkspaceFileContents(file: file, line: selection.line,
                                          renderMarkdown: isMarkdown && !showSource && selection.line == nil)
                } else if let error {
                    ContentUnavailableView("Couldn’t open file", systemImage: "doc.text", description: Text(error))
                } else {
                    ProgressView("Opening file…")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(DS.Color.bg)
            .navigationTitle((selection.path as NSString).lastPathComponent)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                }
                if isMarkdown, selection.line == nil, file != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(showSource ? "Preview" : "Source") { showSource.toggle() }
                    }
                }
            }
        }
        .task(id: selection.id) {
            file = nil
            error = nil
            do {
                guard let app = links.app else {
                    error = "Connect to Studio to open this file."
                    return
                }
                file = try await app.readFile(threadId: links.threadId, path: selection.path)
            } catch {
                self.error = "The file may have moved, or Studio may be disconnected."
            }
        }
    }
}

private struct WorkspaceFileContents: View {
    let file: WorkspaceFile
    let line: Int?
    let renderMarkdown: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(file.path).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                    if file.truncated {
                        Text("Showing the first part of this file.").font(.caption).foregroundStyle(.secondary)
                    }
                    if renderMarkdown {
                        MarkdownText(file.contents)
                    } else {
                        let lines = file.contents.components(separatedBy: "\n")
                        LazyVStack(alignment: .leading, spacing: 3) {
                            ForEach(lines.indices, id: \.self) { index in
                                HStack(alignment: .top, spacing: 12) {
                                    Text("\(index + 1)").foregroundStyle(.tertiary).frame(minWidth: 30, alignment: .trailing)
                                    Text(verbatim: lines[index].isEmpty ? " " : lines[index])
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .font(.footnote.monospaced())
                                .textSelection(.enabled)
                                .padding(.vertical, 2)
                                .background(line == index + 1 ? DS.Color.link.opacity(0.1) : .clear)
                                .id(index + 1)
                            }
                        }
                    }
                }
                .padding(16)
            }
            .task(id: file.path) {
                if let line { proxy.scrollTo(line, anchor: .center) }
            }
        }
    }
}
