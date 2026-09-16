import SwiftUI

struct ComposerDiffBubbleStrip: View {
    let diffs: [ComposerDiffPresentation]
    let onOpenDiff: (String) -> Void

    var body: some View {
        // Plain row, no scroll container: glass sampled inside a ScrollView
        // gets clipped to the scroll bounds and renders a smeared shadow —
        // the pills must sit directly in the chrome row, exactly like
        // ScrollToBottomButton does.
        HStack(spacing: 8) {
            ForEach(diffs.filter { $0.fileCount > 0 }) { diff in
                ComposerDiffBubble(
                    title: diff.title,
                    fileCount: diff.fileCount,
                    additions: diff.additions,
                    deletions: diff.deletions,
                    onOpen: { onOpenDiff(diff.id) }
                )
            }
        }
    }
}

struct ComposerDiffBubble: View {
    let title: String?
    let fileCount: Int
    let additions: Int
    let deletions: Int
    let onOpen: () -> Void

    var body: some View {
        Button {
            open()
        } label: {
            HStack(spacing: 6) {
                if additions > 0 || deletions > 0 {
                    DiffCountLabel(value: additions, prefix: "+", color: .green)
                    DiffCountLabel(value: deletions, prefix: "−", color: .red)
                } else {
                    Text(fileCount == 1 ? "1 file" : "\(fileCount) files")
                }
            }
            .font(.footnote)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .composerGlassSurface(shape: .capsule, interactive: true)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { open() }
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint(
            Text(
                "Shows the changed files",
                comment: "Accessibility hint for opening a code diff"
            )
        )
    }

    private func open() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        KeyboardDismissal.dismiss()
        onOpen()
    }

    private var accessibilityLabel: Text {
        if fileCount == 1 {
            Text(
                "Changes: 1 file, \(additions) additions, \(deletions) deletions",
                comment: "Summary of a one-file code diff above the message composer"
            )
        } else {
            Text(
                "Changes: \(fileCount) files, \(additions) additions, \(deletions) deletions",
                comment: "Summary of a multi-file code diff above the message composer"
            )
        }
    }
}

private struct DiffCountLabel: View {
    let value: Int
    let prefix: String
    let color: Color

    var body: some View {
        Text(verbatim: "\(prefix)\(value)")
            .font(.caption.monospacedDigit().weight(.medium))
            .foregroundStyle(color)
    }
}
