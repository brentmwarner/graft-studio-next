import SwiftUI
import UIKit

/// Quiet action row under each settled assistant reply: copy, read aloud,
/// share, and an overflow with select-text and conversation export. No thumbs —
/// we send no training feedback.
struct MessageActionBar: View {
    @Environment(AppModel.self) private var app
    let item: TranscriptItem

    @State private var showSelectText = false

    /// This row is the one currently being spoken (fetching or playing).
    /// When `speakingItemID` is nil (e.g. auto-speak without an explicit ID),
    /// fall back to treating the last settled assistant message as the active row.
    private var isSpeakingThis: Bool {
        let speakerActive = app.speaker.isSpeaking || app.speaker.isFetching
        if let id = app.speaker.speakingItemID {
            return id == item.id && speakerActive
        }
        let lastSettled = app.activeChat?.items.last { $0.kind == .assistant && !$0.isStreaming }
        return speakerActive && lastSettled?.id == item.id
    }

    var body: some View {
        // Two controls only: copy (the overwhelmingly common action) and an
        // overflow with everything situational. A row of bare glyphs reads as
        // mystery chrome under every reply.
        HStack(spacing: 2) {
            CopyButton(text: item.text, size: 15)

            Menu {
                // Read-aloud needs a synthesizer; the item hides (rather than
                // dead-taps) until the host offers one.
                if app.tts != nil {
                    Button {
                        if isSpeakingThis {
                            app.speaker.stop()
                        } else {
                            app.speaker.speak(text: item.text, itemID: item.id, rest: app.tts)
                        }
                    } label: {
                        Label(
                            isSpeakingThis ? "Stop reading" : "Read aloud",
                            systemImage: isSpeakingThis ? "stop.fill" : "speaker.wave.2"
                        )
                    }
                }
                ShareLink(item: item.text) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
                Button {
                    showSelectText = true
                } label: {
                    Label("Select text", systemImage: "selection.pin.in.out")
                }
                ShareLink(
                    item: ConversationExport.exported(from: app.activeChat?.items ?? [item]),
                    preview: SharePreview("Conversation")
                ) {
                    Label("Export conversation", systemImage: "arrow.down.doc")
                }
            } label: {
                icon("ellipsis")
            }
            .accessibilityLabel("More")

            Spacer(minLength: 0)
        }
        .padding(.top, 2)
        .sheet(isPresented: $showSelectText) {
            SelectableTextSheet(text: item.text)
        }
    }

    private func icon(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(.secondary)
            .frame(width: 36, height: 36)
            .contentShape(.rect)
    }
}
