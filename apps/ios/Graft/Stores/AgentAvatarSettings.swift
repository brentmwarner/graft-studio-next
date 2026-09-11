import Foundation
import SwiftUI
import UIKit

/// The six quick solid colors offered in the avatar picker (also a stable
/// fallback palette). Full-spectrum choices come from the system color picker.
enum AgentAvatarColor: String, CaseIterable, Identifiable {
    case graphite
    case blue
    case green
    case plum
    case rose
    case amber

    var id: String { rawValue }

    var title: String {
        switch self {
        case .graphite: "Graphite"
        case .blue: "Blue"
        case .green: "Green"
        case .plum: "Plum"
        case .rose: "Rose"
        case .amber: "Amber"
        }
    }

    var hex: String {
        switch self {
        case .graphite: "#2E2E30"
        case .blue: "#1F57C7"
        case .green: "#1A734D"
        case .plum: "#572E7A"
        case .rose: "#942947"
        case .amber: "#9E591A"
        }
    }

    var fill: Color { Color(avatarHex: hex) }
}

/// Per-agent (or global, scope "") avatar preference. Persists an
/// `AgentAvatarStyle` (photo / solid / gradient) plus, for the photo case, a
/// normalized JPEG on disk. `AgentAvatarView` turns this into pixels.
@MainActor
@Observable
final class AgentAvatarSettings {
    /// "" = the legacy global inbox avatar; otherwise an agent/profile slug.
    let scope: String

    var style: AgentAvatarStyle {
        didSet { persistStyle() }
    }

    private(set) var imageData: Data?

    private var styleKey: String { scope.isEmpty ? "agentAvatarStyle" : "agentAvatarStyle.\(scope)" }
    private var imageFileName: String { scope.isEmpty ? "agent-avatar.jpg" : "agent-avatar-\(scope).jpg" }
    private var imageURL: URL { Self.storageDirectory.appendingPathComponent(imageFileName) }

    var uiImage: UIImage? { imageData.flatMap { UIImage(data: $0) } }
    var hasCustomImage: Bool { imageData != nil }

    /// The image to draw, only when the chosen style is `.photo`.
    var displayImage: UIImage? {
        if case .photo = style { return uiImage }
        return nil
    }

    /// Whether the user has chosen anything beyond the derived default.
    var isCustomized: Bool {
        if case .auto = style { return false }
        return true
    }

    init(scope: String = "") {
        self.scope = scope
        let fn = scope.isEmpty ? "agent-avatar.jpg" : "agent-avatar-\(scope).jpg"
        let sk = scope.isEmpty ? "agentAvatarStyle" : "agentAvatarStyle.\(scope)"
        let defaults = UserDefaults.standard
        let loadedImage = try? Data(contentsOf: Self.storageDirectory.appendingPathComponent(fn))
        let resolved: AgentAvatarStyle
        if let data = defaults.data(forKey: sk),
           let decoded = try? JSONDecoder().decode(AgentAvatarStyle.self, from: data) {
            resolved = decoded
        } else {
            resolved = Self.migratedStyle(scope: scope, hasImage: loadedImage != nil) ?? .auto
        }
        imageData = loadedImage
        style = resolved
    }

    func setImage(data: Data) async throws {
        // Decode → resize → encode and the disk write are heavy enough to jank
        // the UI on large photos, so run them off the main actor and hop back
        // only for the final @MainActor state mutation.
        let directory = Self.storageDirectory
        let url = imageURL
        let resized = try await Task.detached(priority: .userInitiated) {
            let jpeg = try Self.normalizedJPEGData(from: data)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try jpeg.write(to: url, options: .atomic)
            return jpeg
        }.value
        imageData = resized
        style = .photo
    }

    func removeImage() {
        try? FileManager.default.removeItem(at: imageURL)
        imageData = nil
        if case .photo = style { style = .auto }
    }

    /// Restore a previously-snapshotted style + raw image bytes without
    /// re-encoding — the avatar editor's Cancel path, since its live preview
    /// commits every change immediately.
    func restore(style newStyle: AgentAvatarStyle, imageData data: Data?) {
        if let data {
            try? FileManager.default.createDirectory(at: Self.storageDirectory, withIntermediateDirectories: true)
            try? data.write(to: imageURL, options: .atomic)
            imageData = data
        } else {
            try? FileManager.default.removeItem(at: imageURL)
            imageData = nil
        }
        style = newStyle
    }

    /// Wipe this scope's customization back to the derived default — the stored
    /// photo, the in-memory image, and the persisted style. Runs on account
    /// sign-out so the next account on this device never inherits the previous
    /// user's picture.
    func reset() {
        try? FileManager.default.removeItem(at: imageURL)
        imageData = nil
        style = .auto
        UserDefaults.standard.removeObject(forKey: styleKey)
    }

    private func persistStyle() {
        if let data = try? JSONEncoder().encode(style) {
            UserDefaults.standard.set(data, forKey: styleKey)
        }
    }

    /// One-time fold of the previous mode/color keys into a style.
    private static func migratedStyle(scope: String, hasImage: Bool) -> AgentAvatarStyle? {
        let d = UserDefaults.standard
        let mk = scope.isEmpty ? "agentAvatarMode" : "agentAvatarMode.\(scope)"
        let ck = scope.isEmpty ? "agentAvatarColor" : "agentAvatarColor.\(scope)"
        let mode = d.string(forKey: mk)
        if mode == "image", hasImage { return .photo }
        if mode == "color", let raw = d.string(forKey: ck),
           let color = AgentAvatarColor(rawValue: raw) {
            return .solid(hex: color.hex)
        }
        return nil
    }

    private static var storageDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Hermes", isDirectory: true)
    }

    private nonisolated static func normalizedJPEGData(from data: Data) throws -> Data {
        guard let image = UIImage(data: data) else {
            throw GraftError.decoding("Selected image could not be read.")
        }
        let maxSide: CGFloat = 512
        let longestSide = max(image.size.width, image.size.height)
        let scale = longestSide > maxSide ? maxSide / longestSide : 1
        let targetSize = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: targetSize)
        let rendered = renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: targetSize))
        }
        guard let jpeg = rendered.jpegData(compressionQuality: 0.86) else {
            throw GraftError.decoding("Selected image could not be encoded.")
        }
        return jpeg
    }
}

/// Vends per-agent avatar settings keyed by agent/profile slug, caching one
/// `AgentAvatarSettings` per scope so edits persist and observe live. The global
/// inbox avatar is scope "".
@MainActor
@Observable
final class AgentAvatarStore {
    private var cache: [String: AgentAvatarSettings] = [:]

    func settings(for scope: String) -> AgentAvatarSettings {
        if let existing = cache[scope] { return existing }
        let created = AgentAvatarSettings(scope: scope)
        cache[scope] = created
        return created
    }
}
