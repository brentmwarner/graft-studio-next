import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

// MARK: - Avatar style model

/// How an agent's avatar is drawn. Persisted per profile by `AgentAvatarSettings`.
/// `auto` derives a stable gradient orb from the agent's name so every agent
/// looks intentional before the user customizes anything.
enum AgentAvatarStyle: Codable, Equatable, Hashable {
    case auto
    case photo
    case solid(hex: String)
    case gradient(AvatarGradient)
}

/// A gradient fill: one of the brand orb presets, or a custom two-stop gradient
/// the user mixed in the picker.
enum AvatarGradient: Codable, Equatable, Hashable {
    case preset(String)                                   // AvatarGradientPreset.id
    case custom(from: String, to: String, angle: Double)  // hex, hex, degrees
}

// MARK: - Brand gradient orbs (Rye design system)

/// The six mesh-gradient orbs from the Rye design system's `gradient-orbs.html`
/// — layered radial blobs over a linear base, finished with film grain. Used as
/// avatar imagery (the one place color lives in an otherwise monochrome app).
struct AvatarGradientPreset: Identifiable, Equatable, Hashable {
    let id: String
    let name: String
    let angle: Double
    let base: [String]              // linear base stops, hex
    let blobs: [Blob]               // radial overlays
    let swatch: [String]            // 3 representative hexes (for chips/labels)

    struct Blob: Equatable, Hashable {
        let hex: String
        let x: Double
        let y: Double
        let r: Double               // radius as fraction of the orb diameter
    }

    static let all: [AvatarGradientPreset] = [
        .init(id: "coral", name: "Coral", angle: 160,
              base: ["#FF6F52", "#FF9176", "#FFB088"],
              blobs: [.init(hex: "#FFB39A", x: 0.30, y: 0.28, r: 0.60),
                      .init(hex: "#B7A6E8", x: 0.75, y: 0.30, r: 0.55),
                      .init(hex: "#FF8A65", x: 0.70, y: 0.80, r: 0.65),
                      .init(hex: "#FFC79A", x: 0.28, y: 0.78, r: 0.60)],
              swatch: ["#FF6F52", "#FFB39A", "#B7A6E8"]),
        .init(id: "iris", name: "Iris", angle: 165,
              base: ["#5544C9", "#7E6BDF", "#FFB590"],
              blobs: [.init(hex: "#6B5BD2", x: 0.30, y: 0.22, r: 0.60),
                      .init(hex: "#9C8AE4", x: 0.78, y: 0.38, r: 0.55),
                      .init(hex: "#FFB078", x: 0.60, y: 0.90, r: 0.68)],
              swatch: ["#5544C9", "#9C8AE4", "#FFB590"]),
        .init(id: "sage", name: "Sage", angle: 155,
              base: ["#E2EBD0", "#C9D8C0", "#C7D5DE"],
              blobs: [.init(hex: "#DCE8C5", x: 0.30, y: 0.25, r: 0.55),
                      .init(hex: "#C6D8E9", x: 0.75, y: 0.32, r: 0.60),
                      .init(hex: "#B7CCAA", x: 0.65, y: 0.80, r: 0.62)],
              swatch: ["#E2EBD0", "#C9D8C0", "#C7D5DE"]),
        .init(id: "blossom", name: "Blossom", angle: 160,
              base: ["#FFC2CF", "#E2B8E0", "#FFB8AE"],
              blobs: [.init(hex: "#FFC9D6", x: 0.30, y: 0.25, r: 0.60),
                      .init(hex: "#D7C2E8", x: 0.75, y: 0.35, r: 0.55),
                      .init(hex: "#FFB0A8", x: 0.60, y: 0.85, r: 0.65)],
              swatch: ["#FFC2CF", "#E2B8E0", "#FFB8AE"]),
        .init(id: "mist", name: "Mist", angle: 155,
              base: ["#BFE0DA", "#D6CDE8", "#EDD8E0"],
              blobs: [.init(hex: "#C9E6E2", x: 0.28, y: 0.25, r: 0.55),
                      .init(hex: "#D7CCE8", x: 0.78, y: 0.35, r: 0.60),
                      .init(hex: "#E9D6E1", x: 0.60, y: 0.85, r: 0.65)],
              swatch: ["#BFE0DA", "#D6CDE8", "#EDD8E0"]),
        .init(id: "honey", name: "Honey", angle: 160,
              base: ["#FFEDC4", "#FFD2B0", "#FFBDB5"],
              blobs: [.init(hex: "#FFE9B8", x: 0.30, y: 0.25, r: 0.60),
                      .init(hex: "#FFD0A8", x: 0.75, y: 0.38, r: 0.55),
                      .init(hex: "#FFB8B0", x: 0.60, y: 0.85, r: 0.65)],
              swatch: ["#FFEDC4", "#FFD2B0", "#FFBDB5"]),
        // Rich — moody, dark mesh orbs: deep bases with glowing multi-hue blobs.
        .init(id: "garnet", name: "Garnet", angle: 150,
              base: ["#2A1020", "#1A1228", "#0E0A14"],
              blobs: [.init(hex: "#8E2748", x: 0.28, y: 0.30, r: 0.58),
                      .init(hex: "#2E2A6B", x: 0.78, y: 0.45, r: 0.62),
                      .init(hex: "#4A1530", x: 0.55, y: 0.88, r: 0.60)],
              swatch: ["#8E2748", "#2E2A6B", "#1A1228"]),
        .init(id: "lagoon", name: "Lagoon", angle: 155,
              base: ["#3E9E98", "#7E8BD0", "#B7A8DD"],
              blobs: [.init(hex: "#7FD6CE", x: 0.30, y: 0.28, r: 0.55),
                      .init(hex: "#B9A8E6", x: 0.75, y: 0.42, r: 0.58),
                      .init(hex: "#E6B8D0", x: 0.55, y: 0.86, r: 0.55)],
              swatch: ["#3E9E98", "#7E8BD0", "#B7A8DD"]),
        .init(id: "rust", name: "Rust", angle: 155,
              base: ["#143F39", "#10302C", "#0A201D"],
              blobs: [.init(hex: "#CC6A2E", x: 0.30, y: 0.30, r: 0.62),
                      .init(hex: "#B5491F", x: 0.55, y: 0.52, r: 0.50),
                      .init(hex: "#1C5A50", x: 0.78, y: 0.84, r: 0.58)],
              swatch: ["#CC6A2E", "#1C5A50", "#10302C"]),
        .init(id: "pine", name: "Pine", angle: 150,
              base: ["#0E3A2E", "#0B2A24", "#07201A"],
              blobs: [.init(hex: "#2E7D5E", x: 0.30, y: 0.28, r: 0.58),
                      .init(hex: "#1B5E4A", x: 0.70, y: 0.50, r: 0.55),
                      .init(hex: "#103E33", x: 0.60, y: 0.88, r: 0.55)],
              swatch: ["#2E7D5E", "#1B5E4A", "#0B2A24"]),
        .init(id: "dusk", name: "Dusk", angle: 158,
              base: ["#241A40", "#1A1330", "#100A1E"],
              blobs: [.init(hex: "#5B3FA0", x: 0.30, y: 0.30, r: 0.58),
                      .init(hex: "#8E2D6B", x: 0.72, y: 0.50, r: 0.55),
                      .init(hex: "#2C2160", x: 0.60, y: 0.86, r: 0.55)],
              swatch: ["#5B3FA0", "#8E2D6B", "#1A1330"]),
        .init(id: "cinder", name: "Cinder", angle: 155,
              base: ["#2A1410", "#1C0E0C", "#120807"],
              blobs: [.init(hex: "#C24A2A", x: 0.32, y: 0.34, r: 0.58),
                      .init(hex: "#7F2418", x: 0.68, y: 0.55, r: 0.50),
                      .init(hex: "#3A1A12", x: 0.60, y: 0.86, r: 0.55)],
              swatch: ["#C24A2A", "#7F2418", "#1C0E0C"]),
        // Neutrals — cool, pure, and warm grays for a calmer, darker register.
        .init(id: "slate", name: "Slate", angle: 155,
              base: ["#7C8AA0", "#566175", "#3B4252"],
              blobs: [.init(hex: "#94A3B8", x: 0.30, y: 0.25, r: 0.58),
                      .init(hex: "#64748B", x: 0.75, y: 0.35, r: 0.55),
                      .init(hex: "#475569", x: 0.60, y: 0.85, r: 0.62)],
              swatch: ["#7C8AA0", "#566175", "#3B4252"]),
        .init(id: "graphite", name: "Graphite", angle: 160,
              base: ["#52525B", "#3F3F46", "#27272A"],
              blobs: [.init(hex: "#71717A", x: 0.30, y: 0.25, r: 0.56),
                      .init(hex: "#52525B", x: 0.75, y: 0.38, r: 0.55),
                      .init(hex: "#3F3F46", x: 0.60, y: 0.85, r: 0.62)],
              swatch: ["#52525B", "#3F3F46", "#27272A"]),
        .init(id: "stone", name: "Stone", angle: 158,
              base: ["#8A817C", "#6B6058", "#4A423C"],
              blobs: [.init(hex: "#A8A29E", x: 0.30, y: 0.25, r: 0.56),
                      .init(hex: "#78716C", x: 0.75, y: 0.35, r: 0.55),
                      .init(hex: "#57534E", x: 0.60, y: 0.85, r: 0.62)],
              swatch: ["#8A817C", "#6B6058", "#4A423C"]),
    ]

    static func preset(_ id: String) -> AvatarGradientPreset {
        all.first { $0.id == id } ?? all[0]
    }

    /// Stable preset for an agent name (the `auto` fallback).
    static func derived(for name: String) -> AvatarGradientPreset {
        var hash = 5381
        for byte in name.utf8 { hash = (hash &* 33) &+ Int(byte) }
        return all[Int(UInt(bitPattern: hash) % UInt(all.count))]
    }
}

// MARK: - Periodic-table monogram

enum AgentMonogram {
    /// `researcher` → `Re`, `coder` → `Co`, `ops` → `Op` — element-symbol style:
    /// first letter capitalized, the next letter lowercased.
    static func symbol(for name: String) -> String {
        let letters = name.unicodeScalars.filter { CharacterSet.letters.contains($0) }
        guard let first = letters.first else {
            return String(name.prefix(1)).uppercased()
        }
        let firstChar = String(first).uppercased()
        if let second = letters.dropFirst().first {
            return firstChar + String(second).lowercased()
        }
        return firstChar
    }
}

// MARK: - Film grain (Rye `#grainy` filter)

/// A tiled film-grain overlay matching the design system's `feTurbulence` grain
/// (fractal noise, alpha-composited, `overlay` blend, ~0.55 opacity). The noise
/// tile is generated once and cached.
struct GrainOverlay: View {
    var opacity: Double = 0.5

    var body: some View {
        Image(uiImage: Self.tile)
            .resizable(resizingMode: .tile)
            .blendMode(.overlay)
            .opacity(opacity)
            .allowsHitTesting(false)
    }

    private static let tile: UIImage = {
        let context = CIContext()
        let dim: CGFloat = 160
        let noise = CIFilter.randomGenerator().outputImage ?? CIImage.empty()
        // Collapse to grayscale grain (luminance into RGB), full alpha.
        let gray = noise.applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: 0.33, y: 0.33, z: 0.33, w: 0),
            "inputGVector": CIVector(x: 0.33, y: 0.33, z: 0.33, w: 0),
            "inputBVector": CIVector(x: 0.33, y: 0.33, z: 0.33, w: 0),
            "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0),
            "inputBiasVector": CIVector(x: 0, y: 0, z: 0, w: 1),
        ])
        let rect = CGRect(x: 0, y: 0, width: dim, height: dim)
        guard let cg = context.createCGImage(gray, from: rect) else {
            return UIImage()
        }
        return UIImage(cgImage: cg)
    }()
}

// MARK: - Orb fill

/// Renders a gradient orb: a linear base with layered radial blobs, scaled to
/// the view via the live geometry so it reads the same at 18pt or 96pt.
private struct OrbFill: View {
    let preset: AvatarGradientPreset

    var body: some View {
        GeometryReader { geo in
            let d = min(geo.size.width, geo.size.height)
            ZStack {
                LinearGradient(
                    colors: preset.base.map { Color(avatarHex: $0) },
                    startPoint: Self.points(preset.angle).0,
                    endPoint: Self.points(preset.angle).1
                )
                ForEach(Array(preset.blobs.enumerated()), id: \.offset) { _, blob in
                    RadialGradient(
                        colors: [Color(avatarHex: blob.hex), Color(avatarHex: blob.hex).opacity(0)],
                        center: UnitPoint(x: blob.x, y: blob.y),
                        startRadius: 0,
                        endRadius: blob.r * d
                    )
                }
            }
        }
    }

    /// CSS gradient angle (0° = up) → SwiftUI start/end unit points.
    static func points(_ deg: Double) -> (UnitPoint, UnitPoint) {
        let r = deg * .pi / 180
        let dx = sin(r), dy = -cos(r)
        return (UnitPoint(x: 0.5 - dx / 2, y: 0.5 - dy / 2),
                UnitPoint(x: 0.5 + dx / 2, y: 0.5 + dy / 2))
    }
}

/// A two-stop custom gradient.
private struct CustomGradientFill: View {
    let from: String
    let to: String
    let angle: Double

    var body: some View {
        let pts = OrbFill.points(angle)
        LinearGradient(colors: [Color(avatarHex: from), Color(avatarHex: to)],
                       startPoint: pts.0, endPoint: pts.1)
    }
}

// MARK: - The avatar

/// The agent's face. Renders a photo, a solid color, or a gradient orb (with
/// grain), always topped with the periodic-table monogram. The single source of
/// truth for how an agent looks across the app.
struct AgentAvatarView: View {
    let name: String
    var style: AgentAvatarStyle = .auto
    var image: UIImage? = nil
    var size: CGFloat = 44

    private var resolvedStyle: AgentAvatarStyle {
        if case .auto = style { return .gradient(.preset(AvatarGradientPreset.derived(for: name).id)) }
        return style
    }

    private var isLight: Bool {
        // Gradient orbs and the brand pastels read dark text; solid colors are
        // dark by default. Pastel orbs (sage/mist/blossom/honey) want dark ink.
        if case .gradient(.preset(let id)) = resolvedStyle {
            return ["sage", "mist", "blossom", "honey"].contains(id)
        }
        return false
    }

    private var ink: Color { isLight ? Color.black.opacity(0.62) : .white }

    var body: some View {
        ZStack {
            fill
            if size >= 44 { GrainOverlay(opacity: 0.45) }
            if image == nil { monogram }
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
        .overlay { Circle().strokeBorder(.white.opacity(0.18), lineWidth: 0.5) }
        .accessibilityHidden(true)
    }

    @ViewBuilder private var fill: some View {
        if let image {
            Image(uiImage: image).resizable().scaledToFill()
        } else {
            switch resolvedStyle {
            case .solid(let hex):
                Color(avatarHex: hex)
            case .gradient(.preset(let id)):
                OrbFill(preset: .preset(id))
            case .gradient(.custom(let f, let t, let a)):
                CustomGradientFill(from: f, to: t, angle: a)
            case .photo, .auto:
                OrbFill(preset: .derived(for: name))
            }
        }
    }

    private var monogram: some View {
        Text(AgentMonogram.symbol(for: name))
            .font(.system(size: size * 0.38, weight: .semibold))
            .tracking(-0.5)
            .foregroundStyle(ink)
            .shadow(color: isLight ? .clear : .black.opacity(0.12), radius: 1, y: 0.5)
    }
}

// MARK: - Hex color

extension Color {
    /// Parse `#RRGGBB` / `RRGGBB` (and `#RGB`). Falls back to graphite.
    init(avatarHex raw: String) {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count == 6, let v = UInt64(s, radix: 16) else {
            self = Color(red: 0.18, green: 0.18, blue: 0.19); return
        }
        self = Color(
            red: Double((v >> 16) & 0xFF) / 255,
            green: Double((v >> 8) & 0xFF) / 255,
            blue: Double(v & 0xFF) / 255
        )
    }

    /// `#RRGGBB` for the current resolved RGB (used to round-trip the picker).
    var avatarHexString: String {
        let ui = UIColor(self)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02X%02X%02X",
                      Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded()))
    }
}
