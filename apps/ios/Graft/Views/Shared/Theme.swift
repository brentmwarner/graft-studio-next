import SwiftUI

/// Compatibility shim over the Hermes design system (`DS`). Prefer `DS.*`
/// tokens directly in new code; these aliases keep existing call sites wired to
/// the same source of truth.
enum Theme {
    /// Primary action fill (white on black in dark) — e.g. the composer send button.
    static let bubble = DS.Color.accent
    /// Ink on top of `bubble`.
    static let bubbleText = DS.Color.accentFg
    /// Subtle card/surface fill.
    static let surface = DS.Color.bgSubtle
}

/// The Hermes mark used on the empty-chat home screen — same geometry as the
/// app icon: two stems and a three-dot "typing" crossbar.
struct LogoMark: View {
    var size: CGFloat = 88

    var body: some View {
        Canvas { context, canvasSize in
            let s = canvasSize.width
            let barWidth = s * 0.105
            let barHeight = s * 0.52
            let gap = s * 0.185
            let dotRadius = s * 0.047
            let centerX = s / 2
            let centerY = s / 2

            let bar = { (x: CGFloat) -> Path in
                Path(
                    roundedRect: CGRect(
                        x: x - barWidth / 2,
                        y: centerY - barHeight / 2,
                        width: barWidth,
                        height: barHeight
                    ),
                    cornerRadius: barWidth / 2
                )
            }
            context.fill(bar(centerX - gap), with: .style(.primary))
            context.fill(bar(centerX + gap), with: .style(.primary))

            for offset in [-1.0, 0.0, 1.0] {
                let x = centerX + offset * s * 0.117
                let rect = CGRect(
                    x: x - dotRadius, y: centerY - dotRadius,
                    width: dotRadius * 2, height: dotRadius * 2
                )
                context.fill(Path(ellipseIn: rect), with: .style(.primary))
            }
        }
        .frame(width: size, height: size)
    }
}

/// Circular Liquid Glass icon button used in the floating top bar.
struct GlassIconButton: View {
    let systemImage: String
    var action: () -> Void

    private var symbolFont: Font {
        switch systemImage {
        case "chevron.left", "chevron.right", "chevron.up", "chevron.down":
            .system(size: 18, weight: .light)
        default:
            .system(size: 17, weight: .medium)
        }
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(symbolFont)
                .foregroundStyle(.primary)
                .frame(width: 44, height: 44)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
    }
}

/// ChatGPT-style shimmering label for "Thinking…" states: primary base text
/// with a dimmer band sweeping through it.
struct ShimmerText: View {
    let text: String
    var font: Font = .subheadline.weight(.medium)

    @State private var phase: CGFloat = 0
    @State private var textWidth: CGFloat = 120
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Soft moving band, swept across the text by `phase`. White where the
    /// shimmer is strongest, fading to clear at the edges.
    private var band: some View {
        LinearGradient(
            stops: [
                .init(color: .clear, location: 0),
                .init(color: .white.opacity(0.22), location: 0.24),
                .init(color: .white.opacity(0.68), location: 0.5),
                .init(color: .white.opacity(0.22), location: 0.76),
                .init(color: .clear, location: 1),
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
        .frame(width: max(58, textWidth * 0.56))
        .offset(x: phase)
    }

    var body: some View {
        ZStack {
            // Full-strength text with the moving band *knocked out* of it.
            // A translucent dim glyph laid over an already-opaque one is
            // invisible, so instead we subtract the band (destinationOut) and
            // refill it dim below — the sweep then reads as a genuine notch.
            Text(text)
                .font(font)
                .foregroundStyle(reduceMotion ? .secondary : .primary)
                .overlay {
                    if !reduceMotion {
                        band.blendMode(.destinationOut)
                    }
                }
                .compositingGroup()
            // Dim text revealed only inside the band — the shimmer itself.
            if !reduceMotion {
                Text(text)
                    .font(font)
                    .foregroundStyle(.secondary)
                    .mask { band }
            }
        }
        .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { width in
            textWidth = width
        }
        .task(id: "\(reduceMotion)-\(text)") {
            guard !reduceMotion else {
                phase = 0
                return
            }
            phase = -textWidth
            withAnimation(.linear(duration: 2.0).repeatForever(autoreverses: false)) {
                phase = textWidth
            }
        }
    }
}

/// Glyph-level fade-in for streamed text: glyphs below `progress` are fully
/// visible; a soft edge fades the most recent ones in (the ChatGPT effect).
struct RevealTextRenderer: TextRenderer, Animatable {
    var progress: Double

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        let slices = layout.flatMap { line in line }.flatMap { run in run }
        let count = slices.count
        guard count > 0 else { return }
        let clampedProgress = progress.clamped(to: 0...1)
        if clampedProgress >= 1 {
            for slice in slices {
                context.draw(slice)
            }
            return
        }
        guard clampedProgress > 0 else { return }

        // Width of the fade edge, as a fraction of the whole text.
        let span = max(0.04, 12.0 / Double(count))
        for (index, slice) in slices.enumerated() {
            let position = Double(index + 1) / Double(count)
            let alpha = ((clampedProgress - position) / span + 1).clamped(to: 0...1)
            guard alpha > 0 else { continue }
            var copy = context
            copy.opacity = alpha
            copy.draw(slice)
        }
    }
}

extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}

extension String {
    /// Hermes' TUI skin prefixes status lines with kaomoji ("(⊙_⊙) analyzing…",
    /// "(^_^)V New session started!"). They fit a terminal, not the chat UI.
    /// Drop a leading symbol-heavy face token while keeping real prose intact.
    var strippedStatusFace: String {
        let trimmed = trimmingCharacters(in: .whitespaces)
        guard let firstSpace = trimmed.firstIndex(of: " ") else { return trimmed }
        let head = trimmed[..<firstSpace]
        guard Self.looksLikeStatusFace(String(head)) else { return trimmed }
        let rest = trimmed[trimmed.index(after: firstSpace)...].trimmingCharacters(in: .whitespaces)
        guard !rest.isEmpty else { return trimmed }
        return rest.prefix(1).uppercased() + rest.dropFirst()
    }

    private static func looksLikeStatusFace(_ token: String) -> Bool {
        let asciiWords = token.filter { $0.isASCII && ($0.isLetter || $0.isNumber) }.count
        let symbols = token.filter { !$0.isLetter && !$0.isNumber && !$0.isWhitespace }.count
        if asciiWords == 0, symbols > 0 { return true }
        guard token.first == "(", symbols >= 3 else { return false }
        return asciiWords <= 1
    }
}

extension View {
    /// Standard chrome for hub section pages: plain white background instead
    /// of the stock grouped-gray, inline title, and the same feathered top
    /// fade used by the chat and inbox chrome.
    func hubPage(_ title: String) -> some View {
        self
            .scrollContentBackground(.hidden)
            .background(DS.Color.bg)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(DS.Color.bg, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .overlay(alignment: .top) {
                EdgeFadeBlur(edge: .top)
                    .frame(height: 112)
                    .padding(.bottom, -64)
                    .ignoresSafeArea(edges: .top)
                    .allowsHitTesting(false)
            }
    }

    /// Uniform-white drawer chrome — hides the stock grouped-gray scroll
    /// background and pins the nav bar to white so a sheet's toolbar and content
    /// read as one surface (no white-toolbar-over-off-white-content seam). The
    /// drawer twin of `hubPage(_:)`, minus the title and top fade.
    func drawerSurface() -> some View {
        self
            .scrollContentBackground(.hidden)
            .background(DS.Color.bg)
            .toolbarBackground(DS.Color.bg, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }
}

/// Minimal section header for plain lists.
struct PlainHeader: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.primary)
            .textCase(nil)
    }
}
