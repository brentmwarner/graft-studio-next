import SwiftUI

/// The design system's one sanctioned signature motion: a hairline highlight
/// traveling around a card border while work is in flight
/// (`ios/DesignSystem/README.md`). An oversized angular gradient rotates behind
/// a stroke mask so the beam tracks the border at any aspect ratio.
private struct BorderBeam: ViewModifier {
    let radius: CGFloat
    let active: Bool

    @State private var rotation: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.overlay {
            if active, !reduceMotion {
                GeometryReader { proxy in
                    let diagonal = (proxy.size.width * proxy.size.width
                        + proxy.size.height * proxy.size.height).squareRoot()
                    AngularGradient(
                        stops: [
                            .init(color: .clear, location: 0),
                            .init(color: .clear, location: 0.72),
                            .init(color: DS.Color.fg.opacity(0.75), location: 0.92),
                            .init(color: .clear, location: 1),
                        ],
                        center: .center
                    )
                    .frame(width: diagonal, height: diagonal)
                    .rotationEffect(.degrees(rotation))
                    .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
                }
                .mask {
                    RoundedRectangle(cornerRadius: radius)
                        .strokeBorder(lineWidth: 1.5)
                }
                .allowsHitTesting(false)
                .onAppear {
                    rotation = 0
                    withAnimation(.linear(duration: 1.6).repeatForever(autoreverses: false)) {
                        rotation = 360
                    }
                }
            }
        }
    }
}

extension View {
    /// Runs the traveling border highlight while `active`; honors Reduce Motion.
    func borderBeam(radius: CGFloat, active: Bool) -> some View {
        modifier(BorderBeam(radius: radius, active: active))
    }
}
