import SwiftUI
import UIKit

/// The signed-in person's avatar. Renders the SAME `AgentAvatarView` as agents,
/// but layers the Clerk profile photo in as the default: a locally-set photo
/// wins, else the Clerk image (when the user has a real one and hasn't picked a
/// distinct color/gradient), else the generated orb + monogram. The Clerk image
/// loads async and is cached for the view's lifetime.
struct UserAvatarView: View {
    let name: String
    var settings: AgentAvatarSettings
    /// Clerk profile-image URL. Used only when the user has a real Clerk image
    /// and hasn't picked a distinct avatar; pass nil to skip entirely.
    var clerkImageURL: String?
    var size: CGFloat = 44

    @State private var remote: UIImage?

    /// True while the local avatar is still the name-derived default — `.auto`,
    /// or the exact gradient the picker seeds from the name. (Opening the editor
    /// commits that derived gradient to the bound settings, so we must not treat
    /// it as a deliberate choice that should hide the user's real photo.)
    private var isDefaultLook: Bool {
        switch settings.style {
        case .auto:
            return true
        case .gradient(.preset(let id)):
            return id == AvatarGradientPreset.derived(for: name).id
        case .gradient(.custom(let from, let to, let angle)):
            let p = AvatarGradientPreset.derived(for: name)
            return from.caseInsensitiveCompare(p.swatch.first ?? "—") == .orderedSame
                && to.caseInsensitiveCompare(p.swatch.last ?? "—") == .orderedSame
                && angle == p.angle
        case .photo, .solid:
            return false
        }
    }

    /// What `AgentAvatarView` draws: a local photo first, then the Clerk default.
    private var image: UIImage? {
        if let local = settings.displayImage { return local }
        return isDefaultLook ? remote : nil
    }

    var body: some View {
        AgentAvatarView(name: name, style: settings.style, image: image, size: size)
            .task(id: clerkImageURL) { await loadClerkImage() }
    }

    private func loadClerkImage() async {
        remote = nil
        guard settings.displayImage == nil, isDefaultLook,
              let urlString = clerkImageURL, let url = URL(string: urlString) else { return }
        guard let (data, _) = try? await URLSession.shared.data(from: url),
              let img = UIImage(data: data) else { return }
        remote = img
    }
}
