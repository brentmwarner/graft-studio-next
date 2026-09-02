import SwiftUI

/// Shader-driven liquid-glass fill (the sign-in pill surface): a multiply
/// transmission layer that keeps the backdrop visible through a dark (or
/// light) tint, plus an additive sheen/specular-rim pass.
///
/// The blend modes (not the shader) reach the backdrop, so callers must NOT
/// wrap this in a `compositingGroup()` — that would isolate them from it.
struct GlassSurface<S: Shape>: View {
    var dark: Bool
    var shape: S

    init(dark: Bool, in shape: S) {
        self.dark = dark
        self.shape = shape
    }

    var body: some View {
        let d: Float = dark ? 1 : 0
        ZStack {
            // transmission: backdrop × dark tint → stays black, still see-through.
            shape
                .fill(.white)
                .visualEffect { content, proxy in
                    content.colorEffect(
                        ShaderLibrary.onboardingPillGlassTint(.float2(proxy.size), .float(d))
                    )
                }
                .blendMode(.multiply)

            // reflections: additive sheen / specular rim / edge dispersion.
            shape
                .fill(.black)
                .visualEffect { content, proxy in
                    content.colorEffect(
                        ShaderLibrary.onboardingPillGlassSpec(.float2(proxy.size), .float(d))
                    )
                }
                .blendMode(.plusLighter)
        }
    }
}

/// Press feedback that survives a custom (non-`.glassEffect`) background: a
/// small, quick scale-down, matching the standard pill press.
struct PillPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}
