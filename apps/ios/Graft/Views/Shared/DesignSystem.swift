import SwiftUI

/// Hermes design system — the single source of truth for color, type, spacing,
/// radii, and motion. Translated from the Claude Design "Hermes" handoff
/// (claude.ai/design): a pure-monochrome register in the spirit of ChatGPT +
/// ElevenLabs. No chromatic accent in chrome; the status hues appear only in
/// data and feedback. Typeface is SF (the system font), the design system's
/// documented iOS default.
///
/// Tokens are defined for both polarities and resolve automatically from the
/// app's persisted System / Light / Dark appearance choice.
enum DS {

    // MARK: Color

    enum Color {
        /// App background. Black in dark, white in light.
        static let bg = adaptive(light: 0xFFFFFF, dark: 0x000000)
        /// Resting card / elevated surface.
        static let bgElevated = adaptive(light: 0xFFFFFF, dark: 0x0E0E0F)
        /// Grouped / inset region, list cells, hover fill.
        static let bgSubtle = adaptive(light: 0xF5F5F7, dark: 0x141416)
        /// One step deeper than subtle (pressed, muted chips).
        static let bgMuted = adaptive(light: 0xF5F5F7, dark: 0x303030)

        /// Primary ink.
        static let fg = adaptive(light: 0x000000, dark: 0xFFFFFF)
        /// Body emphasis / muted text.
        static let fgMuted = adaptive(light: 0x303030, lightA: 1, dark: 0xFFFFFF, darkA: 0.72)
        /// Captions, secondary labels, tertiary meta (timestamps, markers).
        /// Darkened from 0x8E8E93 (3.26:1 — failed WCAG AA) to 0x6E6E73 so it
        /// clears AA 4.5:1 for text on `bg` (5.07:1). Still clearly a step below
        /// `fgMuted` in the neutral ramp.
        static let fgSubtle = adaptive(light: 0x6E6E73, lightA: 1, dark: 0xEBEBF5, darkA: 0.55)
        /// Decorative chrome and disabled controls. Do not use for meaningful
        /// text: its intentionally low contrast is below the 4.5:1 AA target.
        static let fgFaint = adaptive(light: 0xB0B0B5, lightA: 1, dark: 0xEBEBF5, darkA: 0.30)

        /// 1px hairline border.
        static let border = adaptive(light: 0xE5E5EA, lightA: 1, dark: 0xFFFFFF, darkA: 0.08)
        /// Stronger border — inputs, focus, dividers that need to read.
        static let borderStrong = adaptive(light: 0xD2D2D7, lightA: 1, dark: 0xFFFFFF, darkA: 0.14)

        /// Primary action fill — the neutral foreground. White on black (dark),
        /// black on white (light). There is no chromatic CTA.
        static let accent = adaptive(light: 0x000000, dark: 0xFFFFFF)
        /// Ink on top of `accent`.
        static let accentFg = adaptive(light: 0xFFFFFF, dark: 0x000000)

        /// Translucent fill for the user's chat bubble (never solid).
        static let bubbleFill = adaptive(light: 0x000000, lightA: 0.06, dark: 0xFFFFFF, darkA: 0.10)

        // Status — used ONLY in data and feedback (badges, run states, errors),
        // never in chrome, nav, or CTAs.
        static let success = adaptive(light: 0x1F7A4D, dark: 0x5EE6A3)
        static let info = adaptive(light: 0x1A56DB, dark: 0x7FB4FF)
        static let link = adaptive(light: 0x2F789C, dark: 0x78B7D5)
        static let warning = adaptive(light: 0xB45309, dark: 0xE0C46C)
        static let danger = adaptive(light: 0xB42318, dark: 0xE37070)
    }

    // MARK: Spacing — 8px base unit

    enum Space {
        static let half: CGFloat = 4
        static let s1: CGFloat = 8
        static let s2: CGFloat = 16
        static let s3: CGFloat = 24
        static let s4: CGFloat = 32
        static let s5: CGFloat = 40
        static let s6: CGFloat = 48
        static let s8: CGFloat = 64
        static let s10: CGFloat = 80
        static let s12: CGFloat = 96
        static let s16: CGFloat = 128
    }

    // MARK: Corner radii — generous, rounded

    enum Radius {
        static let xs: CGFloat = 6     // tooltips, code chips
        static let sm: CGFloat = 10    // tags, small chips
        static let md: CGFloat = 14    // buttons, inputs
        static let lg: CGFloat = 20    // cards
        static let bubble: CGFloat = 22 // chat bubbles
        static let xl: CGFloat = 28    // sheets
        static let xxl: CGFloat = 40   // hero panels
        static let pill: CGFloat = 999 // pills, avatars
    }

    // MARK: Type — SF, mobile-first scale (sentence case, ≤600 weight)

    enum Font {
        static let caption = system(12, .regular)   // meta, timestamps
        static let footnote = system(13, .regular)  // secondary labels
        static let subhead = system(14, .medium)    // small UI labels, tab text
        static let callout = system(15, .medium)    // inline emphasis
        static let body = system(16, .regular)      // default reading size
        static let headline = system(17, .semibold) // list-row primary, buttons
        static let title3 = system(20, .semibold)   // card titles
        static let title2 = system(22, .semibold)   // section titles
        static let title1 = system(28, .semibold)   // screen titles (large nav)
        static let display2 = system(32, .semibold) // hero, small screens
        static let display1 = system(40, .semibold) // big numeric / onboarding hero

        private static func system(_ size: CGFloat, _ weight: SwiftUI.Font.Weight) -> SwiftUI.Font {
            .system(size: size, weight: weight)
        }
    }

    /// Letter-spacing for display headings (applied via `.tracking`). Body text
    /// uses ~ -0.01em; display uses ~ -0.022em — these are point approximations.
    enum Tracking {
        static let body: CGFloat = -0.2
        static let display: CGFloat = -0.6
    }

    // MARK: Motion — subtle and fast

    enum Motion {
        static let durFast: TimeInterval = 0.12  // hover / press color
        static let durBase: TimeInterval = 0.20  // layout / transform
        static let durSlow: TimeInterval = 0.40  // entries / exits

        /// For things appearing — decelerating.
        static let appear = SwiftUI.Animation.timingCurve(0.16, 1, 0.3, 1, duration: durSlow)
        /// For state changes — symmetric.
        static let state = SwiftUI.Animation.timingCurve(0.65, 0, 0.35, 1, duration: durBase)
        /// Fast color/press feedback.
        static let fast = SwiftUI.Animation.timingCurve(0.16, 1, 0.3, 1, duration: durFast)
    }

    // MARK: Helpers

    private static func adaptive(
        light: UInt, lightA: Double = 1,
        dark: UInt, darkA: Double = 1
    ) -> SwiftUI.Color {
        SwiftUI.Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(rgb: dark, alpha: darkA)
                : UIColor(rgb: light, alpha: lightA)
        })
    }
}

private extension UIColor {
    convenience init(rgb: UInt, alpha: Double) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: CGFloat(alpha)
        )
    }
}

// MARK: - Card surface

extension View {
    /// Neutral cards separate through their fill and spacing.
    func dsCard(padding: CGFloat = 20, radius: CGFloat = DS.Radius.lg) -> some View {
        self
            .padding(padding)
            .background(DS.Color.bgSubtle, in: .rect(cornerRadius: radius))
    }

    /// Small soft pill — meta and status chips across hub pages (run state,
    /// toolset on/off, tags). `prominent` darkens the ink for the active case.
    func dsChip(prominent: Bool = false) -> some View {
        self
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(prominent ? DS.Color.fg : DS.Color.fgSubtle)
            .padding(.horizontal, DS.Space.s1 + 1)
            .padding(.vertical, DS.Space.half - 1)
            .background(DS.Color.bgSubtle, in: .capsule)
    }

    /// Filled surface card — a subtle gray fill, **no border, no shadow**. The
    /// calmer alternative to `dsCard()` for grouped read-only content (it reads
    /// as a tinted panel rather than an outlined one). Uses the `bgSubtle`
    /// surface token (light gray on white, faintly raised on black).
    func dsSurface(padding: CGFloat = 20, radius: CGFloat = DS.Radius.lg) -> some View {
        self
            .padding(padding)
            .background(DS.Color.bgSubtle, in: .rect(cornerRadius: radius))
    }

    /// Soft lift under primary CTAs — the one place chrome carries a shadow.
    func dsCTAShadow(enabled: Bool = true) -> some View {
        self
            .shadow(color: .black.opacity(enabled ? 0.08 : 0), radius: 1, y: 1)
            .shadow(color: .black.opacity(enabled ? 0.16 : 0), radius: 8, y: 5)
    }
}

// MARK: - Status chip

/// Semantic state behind a `StatusChip` dot. `.neutral` is the calm / off case
/// (no chromatic signal); the rest map to the DS status palette.
enum DSStatus {
    case neutral, success, warning, danger, info

    var dotColor: SwiftUI.Color {
        switch self {
        case .neutral: DS.Color.fgFaint
        case .success: DS.Color.success
        case .warning: DS.Color.warning
        case .danger:  DS.Color.danger
        case .info:    DS.Color.info
        }
    }
}

/// The single status pill across the app: a calm `bgSubtle` capsule with the
/// neutral subtle ink, where only a small leading dot carries the status color
/// — per the DS rule "monochrome chrome, color only for status/feedback." The
/// monochrome `dsChip()` stays for descriptive, non-status tags (trust level,
/// transport/source meta).
struct StatusChip: View {
    let text: String
    var status: DSStatus

    init(_ text: String, status: DSStatus = .neutral) {
        self.text = text
        self.status = status
    }

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(status.dotColor)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            Text(text)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(DS.Color.fgSubtle)
        }
        .accessibilityElement(children: .combine)
        .padding(.leading, DS.Space.s1)         // 8
        .padding(.trailing, DS.Space.s1 + 2)    // 10
        .padding(.vertical, DS.Space.half - 1)  // 3
        .background(DS.Color.bgSubtle, in: .capsule)
    }
}
