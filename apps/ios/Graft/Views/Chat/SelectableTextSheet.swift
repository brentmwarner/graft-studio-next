import SwiftUI

/// Full-message text presented as plainly selectable content — the guaranteed
/// selection path for cited/badge paragraphs whose custom text renderer
/// disables inline selection.
struct SelectableTextSheet: View {
    let text: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(text)
                    .font(MarkdownStyle.body)
                    .lineSpacing(MarkdownStyle.lineSpacing)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
            }
            .navigationTitle("Select text")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(DS.Color.fg)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

#if DEBUG
#Preview {
    SelectableTextSheet(text: "Select any part of this message and copy it.")
}
#endif
