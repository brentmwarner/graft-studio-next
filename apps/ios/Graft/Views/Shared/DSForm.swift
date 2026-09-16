import SwiftUI

/// Shared DS form anatomy — the card / section / field primitives that let a
/// screen drop the stock grouped `Form` look and read like the rest of the app
/// (the same shapes `SettingsView` uses, extracted so sheets and detail pages
/// can reuse them). Pair with `.hubPage(_:)` on the enclosing `ScrollView` to
/// pick up the DS background and the custom `EdgeFadeBlur` scroll fade.

// MARK: - Containers

/// Neutral filled surface hosting a vertical run of rows separated
/// by `DSRowDivider`. Rows pad themselves, so the card carries no inset — the
/// DS replacement for a grouped `Form` cell block.
struct DSCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) { content }
            .background(DS.Color.bgSubtle, in: .rect(cornerRadius: DS.Radius.lg))
            .clipShape(.rect(cornerRadius: DS.Radius.lg))
    }
}

/// Full-width hairline between rows inside a `DSCard`.
struct DSRowDivider: View {
    var body: some View {
        Rectangle().fill(DS.Color.border).frame(height: 1)
    }
}

/// A titled group: sentence-case `PlainHeader`, content (usually a `DSCard`),
/// and an optional caption footer — the DS stand-in for a `Form` `Section`.
struct DSFormGroup<Content: View>: View {
    let title: String?
    var footer: String?
    @ViewBuilder var content: Content

    init(_ title: String? = nil, footer: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.footer = footer
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.s1 + 2) {
            if let title {
                PlainHeader(title)
                    .padding(.horizontal, DS.Space.half)
            }
            content
            if let footer {
                Text(footer)
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Color.fgSubtle)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, DS.Space.half)
            }
        }
    }
}

// MARK: - Rows

/// Caption label stacked over a borderless field — the onboarding / settings
/// field anatomy. Generic over the field content (`TextField`, `SecureField`,
/// `Picker`, …). Place several inside a `DSCard`, divided by `DSRowDivider`.
struct DSFieldRow<Field: View>: View {
    let label: String
    @ViewBuilder var field: Field

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(DS.Font.caption)
                .foregroundStyle(DS.Color.fgSubtle)
            field
        }
        .font(DS.Font.body)
        .padding(.horizontal, DS.Space.s2)
        .padding(.vertical, 12)
    }
}

/// A single full-width control row (toggle, inline picker, button label) sized
/// to the DS card rhythm. The caller supplies the row's contents.
struct DSControlRow<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(.horizontal, DS.Space.s2)
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
    }
}

// MARK: - Field surface

extension View {
    /// Neutral filled surface for a standalone input that sits on
    /// its own (a multi-line `TextEditor`, a search field) rather than as a row
    /// inside a `DSCard`.
    func dsInputBox(radius: CGFloat = DS.Radius.md) -> some View {
        self
            .background(DS.Color.bgSubtle, in: .rect(cornerRadius: radius))
    }
}
