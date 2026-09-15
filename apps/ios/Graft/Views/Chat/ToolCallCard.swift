import SwiftUI

/// One tool invocation, rendered as a quiet ChatGPT-style line that expands
/// to its human detail and raw result. Raw JSON arguments never show
/// collapsed — `ToolPresentation` filters them. Result blocks are neutral
/// fills with no stroke.
struct ToolCallCard: View {
    let item: TranscriptItem
    @State private var expanded = false
    @Environment(\.openURL) private var openURL

    init(item: TranscriptItem, initiallyExpanded: Bool = false) {
        self.item = item
        _expanded = State(initialValue: initiallyExpanded)
    }

    var body: some View {
        let presentation = ToolPresentation(name: item.toolName, context: item.toolContext)
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.snappy) { expanded.toggle() }
            } label: {
                HStack(spacing: 7) {
                    Image(systemName: presentation.symbol)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                        .frame(width: 16)
                    Text(headline(presentation))
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(DS.Color.fgSubtle)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                    Spacer(minLength: 0)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)

            // Screenshots/vision images render inline under the tool line —
            // always visible, since seeing the picture is the point.
            if !item.images.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(item.images) { image in
                        ChatImageView(chatImage: image, style: .inline)
                    }
                }
                .padding(.leading, 23)
            }

            if !expanded, let detail = presentation.detail {
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(DS.Color.fgSubtle)
                    .lineLimit(1)
                    .padding(.leading, 23)
            }

            if expanded {
                VStack(alignment: .leading, spacing: 8) {
                    if let detail = presentation.detail {
                        Text(detail)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                    if !item.toolSummary.isEmpty {
                        Text(item.toolSummary)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .lineLimit(6)
                    }
                    if !item.toolResultText.isEmpty {
                        ScrollView(.horizontal) {
                            Text(item.toolResultText)
                                .font(.caption.monospaced())
                                .textSelection(.enabled)
                                .padding(10)
                        }
                        .frame(maxHeight: 240)
                        .background(DS.Color.bgSubtle, in: .rect(cornerRadius: DS.Radius.md))
                    }
                    if let url = presentation.url {
                        Button {
                            openURL(url)
                        } label: {
                            Label("Open page", systemImage: "safari")
                                .font(.footnote.weight(.medium))
                                .foregroundStyle(DS.Color.fg)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .background(DS.Color.bgSubtle, in: .capsule)
                        }
                        .buttonStyle(.plain)
                    }
                    if item.toolSummary.isEmpty && item.toolResultText.isEmpty && presentation.detail == nil {
                        Text(item.toolStatus == .running ? "Running…" : "No output")
                            .font(.footnote)
                            .foregroundStyle(DS.Color.fgSubtle)
                    }
                }
                .padding(.leading, 23)
                .transition(.opacity)
            }
        }
    }

    private func headline(_ presentation: ToolPresentation) -> String {
        var text = presentation.donePhrase
        if let duration = item.toolDuration, duration >= 0.1 {
            text += String(format: " · %.1fs", duration)
        }
        return text
    }
}
