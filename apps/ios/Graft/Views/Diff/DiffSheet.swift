import SwiftUI

/// Compact file-list sheet for a `diff.get` summary. Full patch viewing stays
/// on the desktop; mobile surfaces what changed so the user can decide next.
struct DiffSheet: View {
    let diff: DiffSummary
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(diff.files) { file in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text(statusGlyph(file.status))
                                .font(.caption.monospaced().weight(.bold))
                                .foregroundStyle(statusColor(file.status))
                                .frame(width: 14, alignment: .center)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(file.path)
                                    .font(.footnote.monospaced())
                                    .lineLimit(2)
                                HStack(spacing: 8) {
                                    if let additions = file.additions, additions > 0 {
                                        Text("+\(additions)")
                                            .foregroundStyle(.green)
                                    }
                                    if let deletions = file.deletions, deletions > 0 {
                                        Text("−\(deletions)")
                                            .foregroundStyle(.red)
                                    }
                                }
                                .font(.caption2.monospacedDigit())
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                } header: {
                    Text(
                        "\(diff.files.count) file\(diff.files.count == 1 ? "" : "s")",
                        comment: "Section header listing changed files in a diff sheet"
                    )
                }
            }
            .navigationTitle(diff.title?.isEmpty == false ? diff.title! : "Changes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func statusGlyph(_ status: String) -> String {
        switch status {
        case "added": "A"
        case "deleted": "D"
        case "renamed": "R"
        default: "M"
        }
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "added": .green
        case "deleted": .red
        case "renamed": .orange
        default: .secondary
        }
    }
}
