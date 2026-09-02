import SwiftUI

/// A small circular brand mark for tool activity. Web tools resolve a real
/// favicon from the target site itself; everything else gets its SF symbol on
/// a neutral fill. Circles ring themselves with the page background so stacks
/// read as cutouts, not strokes.
struct BrandIcon: View {
    let presentation: ToolPresentation
    var size: CGFloat = 26

    var body: some View {
        Group {
            if let url = Self.iconURL(for: presentation) {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image.resizable()
                            .scaledToFit()
                            .frame(width: faviconSize, height: faviconSize)
                            .background(DS.Color.bgSubtle, in: .circle)
                            .clipShape(.circle)
                    } else {
                        symbolBadge
                    }
                }
            } else {
                symbolBadge
            }
        }
        .frame(width: size, height: size)
    }

    /// A favicon fills its circle edge-to-edge while a fallback glyph floats in
    /// padding — so render favicons a touch smaller to even out their visual
    /// weight against the symbol chips beside them in the stack.
    private var faviconSize: CGFloat { size - 2 }

    private var symbolBadge: some View {
        symbolFallback
            .frame(width: size, height: size)
            .background(DS.Color.bgSubtle, in: .circle)
    }

    private var symbolFallback: some View {
        Image(systemName: presentation.symbol)
            .font(.system(size: size * 0.45, weight: .medium))
            .foregroundStyle(DS.Color.fgMuted)
    }

    static func iconURL(for presentation: ToolPresentation) -> URL? {
        if let pageURL = presentation.url, var components = URLComponents(url: pageURL, resolvingAgainstBaseURL: false) {
            components.path = "/favicon.ico"
            components.query = nil
            components.fragment = nil
            return components.url
        }
        guard let domain = presentation.domain else { return nil }
        var components = URLComponents()
        components.scheme = "https"
        components.host = domain
        components.path = "/favicon.ico"
        return components.url
    }
}
