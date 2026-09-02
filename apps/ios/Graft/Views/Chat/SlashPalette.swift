import SwiftUI

/// One slash-command suggestion from the gateway's `complete.slash` RPC —
/// the same registry the TUI uses, so plugins and skill commands appear too.
struct SlashCompletion: Identifiable, Equatable {
    var id: String { text }
    let text: String      // prompt_toolkit insertion *suffix*, e.g. "model "
    let display: String   // full command, e.g. "/model"
    let meta: String      // one-line description / usage hint

    /// Canonical field text for a tap: the full slash command + a space for
    /// arguments. `text` alone can't be used — completions carry only the
    /// suffix relative to what's already typed.
    var fillText: String {
        let command = display.hasPrefix("/")
            ? display
            : "/" + text.trimmingCharacters(in: .whitespaces)
        return command.trimmingCharacters(in: .whitespaces) + " "
    }
}

/// Completion source for the slash palette. The Graft protocol has no
/// completion RPC yet, so this always resolves to no suggestions and the
/// palette stays hidden; the seam keeps `ComposerView` unchanged for when the
/// host grows a command registry.
@MainActor
@Observable
final class SlashCompleter {
    private(set) var items: [SlashCompletion] = []

    func update(query: String, app: AppModel?) {
        items = []
    }

    func clear() {
        items = []
    }
}

/// Liquid-glass command palette floated above the composer while the draft
/// starts with "/": search-as-you-type over the agent's slash commands.
/// Tapping a row fills the field — send runs it.
struct SlashPalette: View {
    let completions: [SlashCompletion]
    let onPick: (SlashCompletion) -> Void

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(completions) { completion in
                    Button {
                        onPick(completion)
                    } label: {
                        SlashPaletteRow(completion: completion)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 6)
        }
        .frame(maxHeight: 264)
        .fixedSize(horizontal: false, vertical: true)
        .background {
            Color.clear.glassEffect(
                .regular,
                in: .rect(cornerRadius: DS.Radius.lg, style: .continuous)
            )
        }
        .padding(.horizontal, 12)
        .accessibilityLabel("Slash commands")
    }
}

private struct SlashPaletteRow: View {
    let completion: SlashCompletion

    var body: some View {
        HStack(spacing: 10) {
            Text(completion.display)
                .font(DS.Font.footnote.weight(.medium))
                .lineLimit(1)
                .layoutPriority(1)
            if !completion.meta.isEmpty {
                Text(completion.meta)
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Color.fgSubtle)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .contentShape(.rect)
    }
}
