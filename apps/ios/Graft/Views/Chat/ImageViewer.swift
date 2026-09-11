import SwiftUI

/// Full-screen image lightbox — the Claude/Codex viewer: black backdrop,
/// pinch + double-tap zoom, drag-to-pan when zoomed, swipe-down to dismiss,
/// and a share button (the share sheet offers Save Image).
struct ImageViewer: View {
    let image: UIImage?
    @Environment(\.dismiss) private var dismiss

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(scale)
                    .offset(offset)
                    .gesture(drag)
                    .simultaneousGesture(magnification)
                    .onTapGesture(count: 2) { toggleZoom() }
            }

            VStack {
                HStack {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.headline)
                            .foregroundStyle(.white)
                            .padding(10)
                            .background(.black.opacity(0.4), in: .circle)
                    }
                    Spacer()
                    if let image {
                        ShareLink(
                            item: Image(uiImage: image),
                            preview: SharePreview("Image", image: Image(uiImage: image))
                        ) {
                            Image(systemName: "square.and.arrow.up")
                                .font(.headline)
                                .foregroundStyle(.white)
                                .padding(10)
                                .background(.black.opacity(0.4), in: .circle)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                Spacer()
            }
        }
        .statusBarHidden()
    }

    private var magnification: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                scale = min(max(lastScale * value, 1), 5)
            }
            .onEnded { _ in
                lastScale = scale
                if scale <= 1 {
                    withAnimation(.snappy) { offset = .zero; lastOffset = .zero }
                }
            }
    }

    private var drag: some Gesture {
        DragGesture()
            .onChanged { value in
                if scale > 1 {
                    offset = CGSize(
                        width: lastOffset.width + value.translation.width,
                        height: lastOffset.height + value.translation.height
                    )
                } else {
                    offset = CGSize(width: 0, height: value.translation.height)
                }
            }
            .onEnded { value in
                if scale > 1 {
                    lastOffset = offset
                } else if value.translation.height > 120 {
                    dismiss()
                } else {
                    withAnimation(.snappy) { offset = .zero }
                }
            }
    }

    private func toggleZoom() {
        withAnimation(.snappy) {
            if scale > 1 {
                scale = 1; lastScale = 1; offset = .zero; lastOffset = .zero
            } else {
                scale = 2.5; lastScale = 2.5
            }
        }
    }
}
