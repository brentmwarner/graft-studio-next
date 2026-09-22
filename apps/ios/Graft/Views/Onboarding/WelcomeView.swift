import SwiftUI

/// First-run welcome: official Graft mark and pairing pill over the desktop
/// new-chat dither-dot wave. Motion respects Reduce Motion.
struct WelcomeView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme

    @State private var showPairing = false

    var body: some View {
        WelcomeStage(
            freezeIntro: reduceMotion,
            dark: colorScheme == .dark,
            isSignedIn: app.auth.isSignedIn,
            isSigningIn: app.auth.isSigningIn,
            email: app.auth.email,
            displayName: app.auth.displayName,
            footnote: footnote,
            footnoteStyle: footnoteStyle,
            onContinue: { Task { await app.auth.signIn() } },
            onPair: { showPairing = true },
            onSignOut: { app.auth.signOut() }
        )
        .background(DS.Color.bg.ignoresSafeArea())
        .sheet(isPresented: $showPairing) {
            PairingView(isPresented: $showPairing)
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
}

// MARK: - Stage

/// Layout root. The wave is a `.background` so it cannot propose a wider
/// size to the CTA column. The intro stops invalidating content after two seconds;
/// the background owns its independent render loop.
private struct WelcomeStage: View {
    var freezeIntro: Bool
    var dark: Bool
    var isSignedIn: Bool
    var isSigningIn: Bool
    var email: String?
    var displayName: String?
    var footnote: String
    var footnoteStyle: Color
    var onContinue: () -> Void
    var onPair: () -> Void
    var onSignOut: () -> Void

    @Environment(\.scenePhase) private var scenePhase
    @State private var introStart = Date()
    @State private var introFinished = false

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0,
                                paused: freezeIntro || introFinished || scenePhase != .active)) { timeline in
            let seconds = freezeIntro || introFinished ? 2 : max(0, timeline.date.timeIntervalSince(introStart))
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                WelcomeHero(seconds: seconds)
                Spacer(minLength: 0)
                WelcomeActions(
                    seconds: seconds,
                    isSignedIn: isSignedIn,
                    isSigningIn: isSigningIn,
                    email: email,
                    displayName: displayName,
                    footnote: footnote,
                    footnoteStyle: footnoteStyle,
                    onContinue: onContinue,
                    onPair: onPair,
                    onSignOut: onSignOut
                )
            }
        }
        .padding(.horizontal, DS.Space.s3 + 6)
        .padding(.bottom, DS.Space.s5)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            DitherWaveBackground(dark: dark)
                .ignoresSafeArea()
        }
        .animation(freezeIntro ? nil : .smooth(duration: 0.3), value: isSignedIn)
        .task {
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            introFinished = true
        }
    }
}

// MARK: - Hero

private struct WelcomeHero: View {
    var seconds: TimeInterval

    var body: some View {
        VStack(spacing: 0) {
            GraftMark(size: 72)

            Text("Graft", comment: "App brand name on the welcome screen")
                .font(.system(size: 32, weight: .semibold))
                .tracking(-0.6)
                .foregroundStyle(DS.Color.fg)
                .padding(.top, DS.Space.s3)
                .accessibilityAddTraits(.isHeader)
        }
        .padding(.horizontal, DS.Space.s5)
        .padding(.vertical, DS.Space.s6)
        .modifier(Beat(s: seconds, delay: 0.52, rise: 0, scaleFrom: 0.93, blurFrom: 2.5))
    }
}

// MARK: - Actions

private struct WelcomeActions: View {
    var seconds: TimeInterval
    var isSignedIn: Bool
    var isSigningIn: Bool
    var email: String?
    var displayName: String?
    var footnote: String
    var footnoteStyle: Color
    var onContinue: () -> Void
    var onPair: () -> Void
    var onSignOut: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            if isSignedIn {
                AccountChip(email: email, displayName: displayName, onSignOut: onSignOut)
                    .padding(.bottom, DS.Space.s2)
                    .modifier(Beat(s: seconds, delay: 0.86, rise: 14))

                GlassActionPill(title: "Pair with Studio", icon: "link", action: onPair)
                    .modifier(Beat(s: seconds, delay: 0.92, rise: 16))
            } else {
                GlassActionPill(
                    title: "Continue with Graft",
                    icon: "person.crop.circle",
                    isBusy: isSigningIn,
                    action: onContinue
                )
                .modifier(Beat(s: seconds, delay: 0.92, rise: 16))
            }

            Text(footnote)
                .font(DS.Font.footnote)
                .foregroundStyle(footnoteStyle)
                .multilineTextAlignment(.center)
                .padding(.top, DS.Space.s2)
                .modifier(Beat(s: seconds, delay: 1.14, rise: 10))
        }
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

/// Inset black-glass action pill. Width comes from the padded column
/// (30pt studio inset) — this view must not be asked to fill the screen.
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
                .padding(.leading, DS.Space.s3 - 2)
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
    var scaleFrom: CGFloat = 1
    var blurFrom: CGFloat = 0

    func body(content: Content) -> some View {
        let x = min(max((s - delay) / dur, 0), 1)
        let e = CGFloat(1 - pow(1 - x, 3))
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
        .environment(MachineStore())
        .preferredColorScheme(.light)
}

#Preview("Dark") {
    WelcomeView()
        .environment(AppModel())
        .environment(MachineStore())
        .preferredColorScheme(.dark)
}
