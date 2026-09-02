import SwiftUI

/// Restrained rise-in entrance: opacity plus a small lift on the design
/// system's ease-out curve, collapsing to a quick crossfade under Reduce
/// Motion. This is the chat's shared motion voice — the same idiom the
/// onboarding pages use for their staggered page entrances.
struct RiseInEffect: ViewModifier {
    let shown: Bool
    var delay: Double = 0
    var lift: CGFloat = 10
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : lift)
            .animation(
                reduceMotion ? DS.Motion.fast : DS.Motion.appear.delay(delay),
                value: shown
            )
    }
}

/// One-shot rise-in that plays when the view first appears — no external flag
/// needed. For views inserted on their own, like a finished card replacing its
/// streaming placeholder.
struct AppearRiseModifier: ViewModifier {
    var delay: Double = 0
    var lift: CGFloat = 10
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .modifier(RiseInEffect(shown: shown, delay: delay, lift: lift))
            .onAppear { shown = true }
    }
}

extension View {
    /// Drive a staggered rise-in off an external flag — e.g. card contents that
    /// cascade in once a shared `shown` state flips true.
    func riseIn(_ shown: Bool, delay: Double = 0, lift: CGFloat = 10) -> some View {
        modifier(RiseInEffect(shown: shown, delay: delay, lift: lift))
    }

    /// One-shot rise-in on first appear.
    func appearRise(delay: Double = 0, lift: CGFloat = 10) -> some View {
        modifier(AppearRiseModifier(delay: delay, lift: lift))
    }
}

/// Subtle press feedback — a small scale and dim while held. Gives the chat's
/// neutral, strokeless surfaces (card rows, tool buttons) a sense of touch they
/// otherwise lack with `.plain`.
struct PressableButtonStyle: ButtonStyle {
    var scale: CGFloat = 0.97

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .opacity(configuration.isPressed ? 0.72 : 1)
            .animation(DS.Motion.fast, value: configuration.isPressed)
    }
}
