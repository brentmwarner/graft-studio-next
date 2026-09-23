import Foundation
import SwiftUI

struct ThreadDetailsPopover: View {
    @Environment(AppModel.self) private var app
    @State private var details: ThreadDetailsInfo?
    @State private var loading = true
    @State private var failed = false
    @State private var reload = 0
    @State private var renaming = false
    let threadId: String
    let fallbackTitle: String

    private var thread: ThreadInfo? {
        app.snapshot?.threads.first { $0.id == threadId } ?? details?.thread
    }

    var body: some View {
        Group {
            if renaming {
                ThreadRenameForm(title: thread?.title ?? fallbackTitle) { title in
                    try await app.renameThread(threadId: threadId, title: title)
                    renaming = false
                } onCancel: {
                    renaming = false
                }
            } else {
                ThreadDetailsContent(
                    thread: thread, title: thread?.title ?? fallbackTitle,
                    projectName: app.snapshot?.projects.first { $0.id == thread?.projectId }?.name,
                    details: details, loading: loading, failed: failed,
                    connected: app.gateway.state == .connected,
                    onRetry: { reload += 1 }, onRename: { renaming = true }
                )
            }
        }
        .task(id: reload) {
            loading = true
            failed = false
            details = nil
            do {
                let result = try await app.fetchThreadDetails(threadId: threadId)
                try Task.checkCancellation()
                details = result
                loading = false
            } catch {
                if !Task.isCancelled { failed = true; loading = false }
            }
        }
    }
}

struct ThreadDetailsContent: View {
    let thread: ThreadInfo?
    let title: String
    let projectName: String?
    let details: ThreadDetailsInfo?
    let loading: Bool
    let failed: Bool
    let connected: Bool
    let onRetry: () -> Void
    let onRename: () -> Void

    private var branchLabel: String {
        if loading { return "Loading branch…" }
        if let branch = details?.branch { return branch }
        if details?.gitStatus == "not_repository" { return "No Git branch" }
        if details?.gitStatus == "available" { return "Detached HEAD" }
        return "Branch unavailable"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Label(branchLabel, systemImage: "arrow.triangle.branch")
                .lineLimit(2).padding(12)
            HStack(spacing: 12) {
                Image(systemName: thread?.mode == "worktree" ? "square.on.square" : "folder")
                VStack(alignment: .leading, spacing: 3) {
                    Text(details?.workspaceName ?? projectName ?? "Workspace").lineLimit(2)
                    Text(thread?.mode == "worktree" ? "Worktree" : "Local")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(12)
            if failed && connected {
                Button(action: onRetry) {
                    Text("Retry").frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.horizontal, 12).contentShape(.rect)
                }
            }
            Divider().padding(.horizontal, 12)
            Button(action: onRename) {
                Text("Rename thread").frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .padding(.horizontal, 12).contentShape(.rect)
            }
            .disabled(!connected)
        }
        .font(.subheadline)
        .padding(6).frame(width: 280, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("thread-details-menu")
    }
}

struct ThreadRenameForm: View {
    @State private var draft: String
    @State private var saving = false
    @State private var error: String?
    @FocusState private var focused: Bool
    let onSave: (String) async throws -> Void
    let onCancel: () -> Void

    init(title: String, onSave: @escaping (String) async throws -> Void, onCancel: @escaping () -> Void) {
        _draft = State(initialValue: title)
        self.onSave = onSave
        self.onCancel = onCancel
    }

    private var trimmed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var valid: Bool { !trimmed.isEmpty && trimmed.utf16.count <= 200 }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Rename thread").font(.headline)
            TextField("Thread name", text: $draft, axis: .vertical)
                .lineLimit(1...3).focused($focused)
                .padding(12).background(.quaternary, in: .rect(cornerRadius: 12))
                .disabled(saving).submitLabel(.done).onSubmit(save)
                .accessibilityIdentifier("thread-name-field")
            if trimmed.utf16.count > 200 {
                Text("Use 200 characters or fewer.").font(.caption).foregroundStyle(.red)
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack {
                Button(action: onCancel) {
                    Text("Cancel").frame(minWidth: 60, minHeight: 44).contentShape(.rect)
                }.disabled(saving)
                Spacer()
                if saving { ProgressView() }
                Button(action: save) {
                    Text("Save").fontWeight(.semibold).frame(minWidth: 60, minHeight: 44).contentShape(.rect)
                }.disabled(saving || !valid)
            }
        }
        .padding(20).frame(width: 300)
        .task { focused = true }
    }

    private func save() {
        guard valid, !saving else { return }
        saving = true
        error = nil
        Task {
            do { try await onSave(trimmed) }
            catch { self.error = error.localizedDescription }
            saving = false
        }
    }
}
