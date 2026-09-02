import SwiftUI

enum ComposerGlassShape {
    case capsule
    case circle
    case roundedRectangle(cornerRadius: CGFloat)
}

extension View {
    func composerGlassSurface(
        shape: ComposerGlassShape,
        interactive: Bool
    ) -> some View {
        modifier(
            ComposerGlassSurfaceModifier(
                shape: shape,
                interactive: interactive
            )
        )
    }
}

private struct ComposerGlassSurfaceModifier: ViewModifier {
    let shape: ComposerGlassShape
    let interactive: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        switch shape {
        case .capsule:
            capsule(content: content)
        case .circle:
            circle(content: content)
        case .roundedRectangle(let cornerRadius):
            roundedRectangle(content: content, cornerRadius: cornerRadius)
        }
    }

    @ViewBuilder
    private func capsule(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(glass, in: .capsule)
        } else {
            content.background(.ultraThinMaterial, in: Capsule())
        }
    }

    @ViewBuilder
    private func circle(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(glass, in: .circle)
        } else {
            content.background(.ultraThinMaterial, in: Circle())
        }
    }

    @ViewBuilder
    private func roundedRectangle(content: Content, cornerRadius: CGFloat) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(glass, in: .rect(cornerRadius: cornerRadius))
        } else {
            content.background(
                .ultraThinMaterial,
                in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            )
        }
    }

    @available(iOS 26.0, *)
    private var glass: Glass {
        interactive ? .regular.interactive() : .regular
    }
}
