import SwiftUI

/// First-run welcome for unpaired users, in the ported design language: the
/// animated ribbon-beam background (Metal, see OnboardingRibbonShader.metal)
/// behind a black-glass Graft mark and the pairing pill. Motion follows the
/// design system (DS curves, no springs): the ribbon reveals top-to-bottom,
/// content rises in on a short stagger, and everything respects Reduce Motion.
struct WelcomeView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme

    @State private var clock = RevealClock()
    @State private var showPairing = false

    var body: some View {
        ZStack {
            DS.Color.bg.ignoresSafeArea()

            if reduceMotion {
                content(0.99e9)        // at rest — no wipe, no beats
            } else {
                TimelineView(.animation) { timeline in
                    content(tick(timeline.date))
                }
            }
        }
        .sheet(isPresented: $showPairing) {
            PairingView(isPresented: $showPairing)
        }
    }

    /// The whole screen as a pure function of the frame-paced clock `s`, so the
    /// entrance beats can never out-run the on-screen ribbon reveal.
    @ViewBuilder private func content(_ s: TimeInterval) -> some View {
        ZStack {
            OnboardingRibbonBackground(
                seconds: reduceMotion ? 8 : s,
                reveal: reduceMotion ? 1 : revealCurve(s),
                dark: colorScheme == .dark
            )
            .ignoresSafeArea()
            .accessibilityHidden(true)

            VStack(spacing: 0) {
                Spacer(minLength: 0)

                GraftGlassMark()
                    .frame(width: 108, height: 108)
                    .accessibilityHidden(true)
                    .modifier(Beat(s: s, delay: 0.52, rise: 0, scaleFrom: 0.93, blurFrom: 2.5))

                Text("Graft", comment: "App brand name on the welcome screen")
                    .font(.system(size: 32, weight: .semibold))
                    .tracking(-0.6)
                    .foregroundStyle(DS.Color.fg)
                    .padding(.top, DS.Space.s3)
                    .modifier(Beat(s: s, delay: 0.68, rise: 12))

                Text(
                    "Control your Graft Studio from anywhere.",
                    comment: "Welcome value proposition under the brand mark"
                )
                .font(.system(size: 16))
                .foregroundStyle(DS.Color.fgSubtle)
                .multilineTextAlignment(.center)
                .padding(.top, DS.Space.s1)
                .padding(.horizontal, DS.Space.s4)
                .modifier(Beat(s: s, delay: 0.78, rise: 12))

                Spacer(minLength: 0)

                // Account first, pairing second: the pill swaps role once a
                // Graft account is signed in.
                if app.auth.isSignedIn {
                    AccountChip(
                        email: app.auth.email,
                        displayName: app.auth.displayName
                    ) {
                        app.auth.signOut()
                    }
                    .padding(.bottom, DS.Space.s2)
                    .modifier(Beat(s: s, delay: 0.86, rise: 14))

                    GlassActionPill(
                        title: "Pair with Graft Studio",
                        icon: "link"
                    ) {
                        showPairing = true
                    }
                    .modifier(Beat(s: s, delay: 0.92, rise: 16))
                } else {
                    GlassActionPill(
                        title: "Continue with Graft",
                        icon: "person.crop.circle",
                        isBusy: app.auth.isSigningIn
                    ) {
                        Task { await app.auth.signIn() }
                    }
                    .modifier(Beat(s: s, delay: 0.92, rise: 16))
                }

                Text(footnote)
                    .font(DS.Font.footnote)
                    .foregroundStyle(footnoteStyle)
                    .multilineTextAlignment(.center)
                    .padding(.top, DS.Space.s2)
                    .modifier(Beat(s: s, delay: 1.14, rise: 10))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.horizontal, DS.Space.s3 + 6)         // 30 — matches the studio
            .padding(.bottom, DS.Space.s5)                 // 40
            // Cross-fade the pill's sign-in → pairing role swap.
            .animation(.smooth(duration: 0.3), value: app.auth.isSignedIn)
        }
    }

    private var footnote: String {
        if let error = app.auth.lastError {
            return error
        }
        if app.auth.isSignedIn {
            return "Open Graft Studio on this computer,\nthen scan or paste the pairing link."
        }
        return "Sign in to connect this iPhone to your Studio."
    }

    private var footnoteStyle: Color {
        if app.auth.lastError != nil { return DS.Color.danger }
        return colorScheme == .dark ? DS.Color.fgMuted : DS.Color.fgSubtle
    }

    /// Frame-paced clock: each delta is capped (≤1/30 s) so a stalled first
    /// frame — Metal pipeline compile, or late composition — can't
    /// fast-forward the intro past the viewer.
    private func tick(_ now: Date) -> TimeInterval {
        if let last = clock.last { clock.t += min(now.timeIntervalSince(last), 1.0 / 30.0) }
        clock.last = now
        return clock.t
    }

    /// Strong ease-out (cubic) over the 1.1s reveal window.
    private func revealCurve(_ s: TimeInterval) -> Float {
        let p = min(max(s / 1.1, 0), 1)
        return Float(1 - pow(1 - p, 3))
    }
}

// MARK: - Ribbon background

/// Hosts the `onboardingRibbon` Metal color effect over the active theme
/// ground. Stateless — the parent's frame-paced clock supplies `seconds`
/// (continuous flow motion) and `reveal` (the 0→1 top-to-bottom first-run wipe).
private struct OnboardingRibbonBackground: View {
    var seconds: TimeInterval
    var reveal: Float
    var dark: Bool

    var body: some View {
        Rectangle()
            .fill(dark ? .black : .white)
            .visualEffect { content, proxy in
                content.colorEffect(
                    ShaderLibrary.onboardingRibbon(
                        .float2(proxy.size),
                        .float(Float(seconds)),
                        .float(reveal),
                        .float(dark ? 1 : 0)
                    )
                )
            }
    }
}

/// Mutable render clock for the intro — a reference type so advancing it inside
/// the TimelineView body doesn't invalidate the surrounding view.
private final class RevealClock {
    var last: Date?
    var t: TimeInterval = 0
}

// MARK: - Black-glass Graft mark

/// The Graft branch glyph floating on a deep black-glass disc — the same
/// two-pass physical glass surface as the pairing pill, so mark and pill read
/// as one material. Always black glass, matching the app icon in both themes.
private struct GraftGlassMark: View {
    var body: some View {
        ZStack {
            GlassSurface(dark: true, in: .circle)
            Image(systemName: "arrow.triangle.branch")
                .font(.system(size: 44, weight: .medium))
                .foregroundStyle(.white)
        }
        .allowsHitTesting(false)
    }
}

// MARK: - Account chip

/// Quiet signed-in identity above the pairing pill: monogram avatar, the
/// account email, and a sign-out affordance — so it's always clear which
/// Graft account this device will pair under, before any connection exists.
private struct AccountChip: View {
    let email: String?
    let displayName: String?
    let onSignOut: () -> Void

    var body: some View {
        HStack(spacing: DS.Space.s1 + 2) {
            Text(monogram)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(DS.Color.fg)
                .frame(width: 26, height: 26)
                .background(DS.Color.bgSubtle, in: .circle)

            Text(email ?? "Signed in")
                .font(DS.Font.footnote)
                .foregroundStyle(DS.Color.fgMuted)
                .lineLimit(1)
                .truncationMode(.middle)

            Button("Sign out", action: onSignOut)
                .font(DS.Font.footnote.weight(.medium))
                .foregroundStyle(DS.Color.fg)
                .buttonStyle(.plain)
                .padding(.leading, DS.Space.half)
        }
        .padding(.leading, 6)
        .padding(.trailing, DS.Space.s2)
        .padding(.vertical, 6)
        .glassEffect(.regular, in: .capsule)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Signed in as \(email ?? "your Graft account")")
    }

    private var monogram: String {
        let source = displayName?.isEmpty == false ? displayName : email
        guard let first = source?.first(where: \.isLetter) else { return "•" }
        return String(first).uppercased()
    }
}

// MARK: - Action pill

/// Full-width black-glass action pill — the Hermes provider-pill anatomy:
/// icon pinned left, label centered. Serves both the sign-in and pairing
/// steps so the welcome screen swaps role without swapping material.
private struct GlassActionPill: View {
    let title: String
    let icon: String
    var isBusy = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(title)
                    .font(.system(size: 16.5, weight: .semibold))
                    .tracking(-0.3)
                    .opacity(isBusy ? 0 : 1)
                if isBusy {
                    ProgressView()
                        .tint(.white)
                }
                HStack {
                    Image(systemName: icon)
                        .font(.system(size: 17, weight: .medium))
                    Spacer(minLength: 0)
                }
                .padding(.leading, DS.Space.s3 - 2)         // 22
            }
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .foregroundStyle(.white)
            .contentShape(.capsule)
            .background { GlassSurface(dark: true, in: .capsule) }
            .clipShape(.capsule)
        }
        .buttonStyle(PillPress())
        .disabled(isBusy)
        .accessibilityLabel(title)
    }
}

// MARK: - Glass surface (Metal)

/// Deep, see-through "black glass" in two composited passes (shaders in
/// OnboardingRibbonShader.metal):
///
///   • a **transmission** pass multiplied onto the backdrop (`.multiply`) so
///     the body stays genuinely black while the ribbon still reads through it;
///   • a **reflection** pass added on top (`.plusLighter`) for the sheen,
///     specular rim, and a whisper of edge dispersion.
///
// MARK: - Entrance beat

/// One foreground element's entrance, as a pure function of the intro clock
/// `s`: a fade + rise (optionally a slight grow / focus-in) on a strong
/// ease-out, beginning at `delay`. No state, no implicit animation — every
/// beat reads the same frame-paced `s`, so their order is structural. At rest
/// (`s` ≫ delay) it's the identity.
private struct Beat: ViewModifier {
    let s: TimeInterval
    let delay: Double
    var dur: Double = 0.5
    var rise: CGFloat = 12
    var scaleFrom: CGFloat = 1        // 1 = no scale; < 1 grows in
    var blurFrom: CGFloat = 0         // 0 = no blur; > 0 focuses in

    func body(content: Content) -> some View {
        let x = min(max((s - delay) / dur, 0), 1)
        let e = CGFloat(1 - pow(1 - x, 3))           // easeOutCubic
        return content
            .opacity(Double(e))
            .blur(radius: blurFrom * (1 - e))
            .scaleEffect(scaleFrom + (1 - scaleFrom) * e)
            .offset(y: rise * (1 - e))
    }
}

#Preview("Light") {
    WelcomeView()
        .environment(AppModel())
        .preferredColorScheme(.light)
}

#Preview("Dark") {
    WelcomeView()
        .environment(AppModel())
        .preferredColorScheme(.dark)
}
