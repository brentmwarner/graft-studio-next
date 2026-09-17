import SwiftUI

struct DiffSheet: View {
    let diff: DiffSummary
    let loadFile: (String) async -> DiffSummary?
    @Environment(\.dismiss) private var dismiss
    @State private var expanded = Set<String>()
    @State private var details: [String: DiffFile] = [:]
    @State private var pending = Set<String>()
    @State private var failed = Set<String>()
    @State private var requests: [String: Task<Void, Never>] = [:]
    @State private var revision = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Color.clear.frame(width: 44, height: 44)
                Text("\(diff.files.count) file\(diff.files.count == 1 ? "" : "s") changed")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                Menu {
                    Button("Collapse all files") { expanded.removeAll() }
                        .disabled(expanded.isEmpty)
                    Button("Close changes") { dismiss() }
                } label: {
                    Image(systemName: "ellipsis")
                        .rotationEffect(.degrees(90))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Diff options")
            }
            .padding(.horizontal, 8)
            .padding(.top, 12)
            .padding(.bottom, 6)
            Divider()
            ScrollView {
                LazyVStack(spacing: 0) {
                    if diff.files.isEmpty {
                        Text("No changed files.").foregroundStyle(.secondary).padding(32)
                    }
                    ForEach(diff.files) { file in
                        Button {
                            if expanded.contains(file.path) { expanded.remove(file.path) }
                            else { expanded.insert(file.path); request(file.path) }
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: expanded.contains(file.path) ? "chevron.down" : "chevron.right")
                                    .font(.caption).foregroundStyle(.secondary)
                                Text(file.path).font(.system(size: 13, weight: .semibold))
                                    .lineLimit(1).truncationMode(.middle).frame(maxWidth: .infinity, alignment: .leading)
                                Text("+\(file.additions ?? 0)").foregroundStyle(.green)
                                Text("−\(file.deletions ?? 0)").foregroundStyle(.red)
                            }
                            .font(.system(size: 12).monospacedDigit())
                            .foregroundStyle(.primary)
                            .padding(.horizontal, 12).frame(minHeight: 44)
                            .background(Color(uiColor: .secondarySystemBackground))
                        }
                        .buttonStyle(.plain)
                        .accessibilityValue(expanded.contains(file.path) ? "Expanded" : "Collapsed")
                        if expanded.contains(file.path) {
                            if pending.contains(file.path) {
                                ProgressView("Loading changes…").frame(maxWidth: .infinity).padding(24)
                            } else if failed.contains(file.path) {
                                VStack(spacing: 12) {
                                    Text("Changes couldn’t be loaded.").foregroundStyle(.secondary)
                                    Button("Try again") { request(file.path, retry: true) }
                                }.frame(maxWidth: .infinity).padding(24)
                            } else if let detail = details[file.path] {
                                DiffFileContent(file: detail)
                            }
                        }
                    }
                }
                .padding(.bottom, 24)
            }
        }
        .task(id: "\(diff.id):\(diff.runId ?? ""):\(diff.updatedAt)") {
            cancelRequests()
            revision = "\(diff.id):\(diff.runId ?? ""):\(diff.updatedAt)"
            details.removeAll(); pending.removeAll(); failed.removeAll()
            expanded = Set(diff.files.prefix(1).map(\.path))
            if let first = diff.files.first { request(first.path) }
        }
        .onDisappear { cancelRequests() }
    }

    private func cancelRequests() {
        for task in requests.values { task.cancel() }
        requests.removeAll()
    }

    private func request(_ path: String, retry: Bool = false) {
        guard !pending.contains(path), retry || details[path] == nil else { return }
        let expectedRevision = revision
        pending.insert(path); failed.remove(path)
        requests[path] = Task { @MainActor in
            let result = await loadFile(path)
            guard !Task.isCancelled, revision == expectedRevision else { return }
            pending.remove(path); requests.removeValue(forKey: path)
            guard let result, diff.acceptsFileResponse(result),
                  let file = result.files.first(where: { $0.path == path }), file.detailStatus != "unavailable" else {
                failed.insert(path)
                return
            }
            details[path] = file
        }
    }
}

private struct DiffHunkSlice: Identifiable {
    let id: Int
    let hunk: DiffHunk
    let lines: [DiffLine]
}

private struct DiffFileContent: View {
    let file: DiffFile
    @Environment(\.colorScheme) private var colorScheme
    @State private var limit = 200

    private var shownHunks: [DiffHunkSlice] {
        var remaining = limit
        return (file.hunks ?? []).enumerated().compactMap { index, hunk in
            guard remaining > 0 else { return nil }
            let lines = Array(hunk.lines.prefix(remaining))
            remaining -= lines.count
            return DiffHunkSlice(id: index, hunk: hunk, lines: lines)
        }
    }

    var body: some View {
        let count = file.hunks?.reduce(0) { $0 + $1.lines.count } ?? 0
        VStack(alignment: .leading, spacing: 0) {
            if let previous = file.previousPath {
                Text("Renamed from \(previous)").font(.caption).foregroundStyle(.secondary).padding(12)
            }
            if file.detailStatus == nil {
                Text("Line changes aren’t available on this host yet.").foregroundStyle(.secondary).padding(24)
            } else if count == 0 {
                Text(file.detailStatus == "truncated" ? "This file is too large to preview." : "Binary or metadata-only change.")
                    .foregroundStyle(.secondary).padding(24)
            } else {
                ScrollView(.horizontal) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(shownHunks) { item in
                            if item.hunk.collapsedBefore > 0 {
                                Text("\(item.hunk.collapsedBefore) unmodified \(item.hunk.collapsedBefore == 1 ? "line" : "lines")")
                                    .font(.system(size: 13)).foregroundStyle(.secondary)
                                    .padding(.horizontal, 10).padding(.vertical, 8)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 7))
                                    .padding(8)
                            }
                            ForEach(Array(item.lines.enumerated()), id: \.offset) { _, line in
                                diffLine(line)
                            }
                        }
                    }
                    .padding(.bottom, 10)
                }
                if count > limit {
                    Button("Show \(min(200, count - limit)) more lines") { limit += 200 }
                        .frame(maxWidth: .infinity).padding(12)
                }
                if file.detailStatus == "truncated" {
                    Text("Preview limited to the first \(count) lines. Open the full diff on your host.")
                        .font(.caption).foregroundStyle(.secondary).padding(12)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func diffLine(_ line: DiffLine) -> some View {
        let added = line.kind == "addition"
        let removed = line.kind == "deletion"
        let color: Color = added ? .green : removed ? .red : .secondary
        return HStack(alignment: .top, spacing: 0) {
            Rectangle().fill(added || removed ? color : .clear).frame(width: 2)
            Text((removed ? line.oldLine : line.newLine).map(String.init) ?? "")
                .foregroundStyle(color).frame(width: 32, alignment: .trailing).padding(.trailing, 6)
            Text(added ? "+" : removed ? "−" : " ").foregroundStyle(color).frame(width: 16)
            Text(code(line)).fixedSize(horizontal: true, vertical: false).padding(.trailing, 20)
        }
        .font(.system(size: 13, design: .monospaced))
        .frame(minHeight: 22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(added || removed ? color.opacity(colorScheme == .dark ? 0.14 : 0.09) : .clear)
        .accessibilityElement(children: .combine)
    }

    private func code(_ line: DiffLine) -> AttributedString {
        guard let tokens = line.tokens, !tokens.isEmpty else { return AttributedString(line.text.isEmpty ? " " : line.text) }
        var result = AttributedString()
        for token in tokens {
            var part = AttributedString(token.text)
            if let hex = colorScheme == .dark ? token.darkColor : token.lightColor,
               let color = syntaxColor(hex) { part.foregroundColor = color }
            if token.changed == true {
                part.backgroundColor = (line.kind == "addition" ? Color.green : .red).opacity(0.2)
            }
            result.append(part)
        }
        return result
    }

    private func syntaxColor(_ hex: String) -> Color? {
        guard hex.count == 7, hex.first == "#", let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        return Color(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
    }
}
