import QuickLook
import SwiftUI

/// An inline transcript image: a rounded, bounded thumbnail that resolves its
/// pixels lazily (off-main, cached) and opens a full-screen zoom/share viewer
/// on tap. Matches the Claude/Codex feel — quiet placeholder while loading,
/// graceful retry on failure.
struct ChatImageView: View {
    @Environment(AppModel.self) private var app
    let chatImage: ChatImage

    /// `.inline` is a natural thumbnail, `.compact` matches Codex-style
    /// assistant attachments, and `.tile` is for composer attachments.
    enum Style { case inline, compact, tile }
    var style: Style = .inline

    /// Non-nil while the system QuickLook preview is presented for this image;
    /// SwiftUI resets it to nil when the viewer is dismissed.
    @State private var previewURL: URL?

    // Thumbnail register: compact assistant media should be just the image,
    // not a separate framed tile.
    private var maxHeight: CGFloat { style == .tile ? 200 : 160 }
    private var compactSize: CGSize { CGSize(width: 142, height: 104) }
    private var radius: CGFloat { DS.Radius.md }

    var body: some View {
        decoratedContent
            .onTapGesture { presentPreview() }
            .task { await chatImage.load(rest: app.rest) }
            // The system image viewer — the same one Files/Mail use.
            .quickLookPreview($previewURL)
            .onChange(of: previewURL) { previous, current in
                // QuickLook has copied what it needs by the time it closes; reclaim
                // the per-preview temp folder when the binding resets to nil.
                if current == nil, let previous {
                    try? FileManager.default.removeItem(at: previous.deletingLastPathComponent())
                }
            }
    }

    /// QuickLook previews a file, not a `UIImage`. Ask the model object for a
    /// preview file so remote/data images can use original bytes rather than the
    /// downsampled chat thumbnail.
    private func presentPreview() {
        guard chatImage.image != nil else { return }
        Task { previewURL = await chatImage.writePreviewTempFile(rest: app.rest) }
    }

    @ViewBuilder
    private var decoratedContent: some View {
        if style == .compact {
            content
                .contentShape(.rect)
        } else {
            content
                .clipShape(.rect(cornerRadius: radius, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .strokeBorder(DS.Color.fg.opacity(0.06), lineWidth: 1)
                )
                .contentShape(.rect(cornerRadius: radius))
        }
    }

    @ViewBuilder
    private var content: some View {
        if let ui = chatImage.image {
            if style == .compact {
                let size = compactFrame(for: ui)
                ZStack {
                    Color.clear
                    Image(uiImage: ui)
                        .resizable()
                        .scaledToFit()
                        .frame(width: size.width, height: size.height)
                }
                .frame(width: compactSize.width, height: compactSize.height)
            } else {
                // No maxWidth: the frame hugs the fitted image, so the rounded
                // card is exactly the picture's shape — no full-width border
                // with dead space, no letterboxing. The lazy stack's width
                // still caps wide images via the fit.
                Image(uiImage: ui)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: maxHeight)
            }
        } else if chatImage.failed {
            placeholder {
                Button {
                    Task { await chatImage.retry(rest: app.rest) }
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: "exclamationmark.triangle")
                        Text("Tap to retry").font(.caption)
                    }
                    .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        } else {
            placeholder {
                ProgressView().controlSize(.small)
            }
        }
    }

    private func placeholder<Inner: View>(@ViewBuilder _ inner: () -> Inner) -> some View {
        // A fixed thumbnail-sized block — full-width placeholders made the
        // card "spread" and then snap when the real image arrived.
        ZStack {
            DS.Color.bgSubtle
            inner()
        }
        .frame(
            width: style == .compact ? compactSize.width : 140,
            height: style == .compact ? compactSize.height : (style == .tile ? 140 : 120)
        )
    }

    private func compactFrame(for image: UIImage) -> CGSize {
        let source = image.size
        guard source.width > 0, source.height > 0 else { return compactSize }
        let scale = min(compactSize.width / source.width, compactSize.height / source.height)
        return CGSize(width: source.width * scale, height: source.height * scale)
    }
}
