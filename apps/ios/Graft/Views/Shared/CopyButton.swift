import SwiftUI
import UIKit

/// A copy-to-clipboard button that confirms the tap by flipping its glyph to a
/// checkmark for a beat, so copy always *feels* like it worked. Used by the
/// code-block header and the message action bar.
struct CopyButton: View {
    let text: String
    var size: CGFloat = 15

    @State private var copied = false
    @State private var resetTask: Task<Void, Never>?

    var body: some View {
        Button {
            UIPasteboard.general.string = text
            withAnimation(.snappy(duration: 0.2)) { copied = true }
            resetTask?.cancel()
            resetTask = Task { @MainActor in
                try? await Task.sleep(for: .seconds(1.5))
                guard !Task.isCancelled else { return }
                withAnimation(.snappy(duration: 0.2)) { copied = false }
            }
        } label: {
            Image(systemName: copied ? "checkmark" : "doc.on.doc")
                .font(.system(size: size, weight: .medium))
                // Ternary mixes a Color (DS.Color.fg) and a hierarchical style
                // (.secondary), so both branches are erased to AnyShapeStyle.
                // Monochrome confirmation — DS.Color.fg, not green.
                .foregroundStyle(copied ? AnyShapeStyle(DS.Color.fg) : AnyShapeStyle(.secondary))
                .frame(width: 36, height: 36)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(trigger: copied) { _, now in now ? .success : nil }
        .accessibilityLabel(copied ? "Copied" : "Copy")
    }
}

#if DEBUG
#Preview {
    CopyButton(text: "echo hello")
        .padding()
}
#endif
