import SwiftUI

/// Progressive fade-blur for chrome edges: content scrolling under the bar
/// blurs and washes toward the background, feathering to clear — the
/// gradient-masked-material approximation of Apple's variable blur, layered
/// under floating glass pills so the chrome reads as one elegant plane.
struct EdgeFadeBlur: View {
    var edge: VerticalEdge

    @Environment(\.colorScheme) private var colorScheme
    /// Peak background wash at the edge. The default is the chat register — the
    /// faintest breath, content stays visible. Chrome that carries controls
    /// (the inbox header's filter chips) passes a deeper wash so scrolled rows
    /// can't fight the chips for legibility.
    var washOpacity: Double = 0.12
    /// Fraction of the height the wash holds near-peak before feathering out.
    /// 0 (default) fades from the very edge — the chat register.
    var washHold: CGFloat = 0

    var body: some View {
        ZStack {
            // Staggered layers: blur COMPOUNDS at the edge and relaxes one
            // layer at a time, so intensity genuinely ramps — a single
            // masked material fades alpha, which reads as a hard-edged bar.
            blurLayer(span: 1.0)
            blurLayer(span: 0.6)
            blurLayer(span: 0.35)
            // The background wash: full strength through the hold plateau,
            // then an eased fall-off. At the default 0.12/0 the hold stop is
            // coincident with (and equal to) the edge stop, and the midpoint
            // sits on the old two-stop linear ramp — chat renders exactly as
            // before.
            LinearGradient(
                stops: [
                    .init(color: DS.Color.bg.opacity(washOpacity), location: 0),
                    .init(color: DS.Color.bg.opacity(washOpacity), location: washHold),
                    .init(color: DS.Color.bg.opacity(washOpacity * 0.45), location: washHold + (1 - washHold) * 0.55),
                    .init(color: DS.Color.bg.opacity(0), location: 1),
                ],
                startPoint: start,
                endPoint: end
            )
        }
        .allowsHitTesting(false)
    }

    /// One material sheet fading out across `span` of the height, with eased
    /// stops so no layer ends on a visible line.
    private func blurLayer(span: CGFloat) -> some View {
        Rectangle()
            .fill(.ultraThinMaterial)
            // Dark mode: the material's gray base plate, compounded across the
            // three sheets, lifts the pure-black background into a milky wash.
            // Sink each sheet back toward bg so the blur feathers into black
            // instead of gray. Light mode keeps the original material-only tree.
            .darkModeMaterialCompensation(colorScheme == .dark)
            .mask {
                LinearGradient(
                    stops: [
                        .init(color: .black, location: 0),
                        .init(color: .black.opacity(0.7), location: span * 0.35),
                        .init(color: .black.opacity(0.3), location: span * 0.7),
                        .init(color: .clear, location: span),
                    ],
                    startPoint: start,
                    endPoint: end
                )
            }
    }

    private var start: UnitPoint { edge == .top ? .top : .bottom }
    private var end: UnitPoint { edge == .top ? .bottom : .top }
}

private extension View {
    @ViewBuilder
    func darkModeMaterialCompensation(_ isDarkMode: Bool) -> some View {
        if isDarkMode {
            overlay(DS.Color.bg.opacity(0.45))
        } else {
            self
        }
    }
}
