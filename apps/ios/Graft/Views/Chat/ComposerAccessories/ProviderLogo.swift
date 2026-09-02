import SwiftUI

/// Provider brand mark for the composer's model controls — the same marks the
/// desktop composer shows. Known providers get their catalog asset; anything
/// else falls back to a monogram tile so an unrecognized provider still reads.
struct ProviderLogoView: View {
    let providerId: String
    let label: String?
    var size: CGFloat = 22

    private static let assetNames: [String: String] = [
        "anthropic": "ProviderAnthropic",
        "openai": "ProviderOpenAI",
        "google": "ProviderGoogle",
    ]

    var body: some View {
        if let asset = Self.assetNames[providerId] {
            Image(asset)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: size * 0.225))
        } else {
            monogram
        }
    }

    private var monogram: some View {
        let initial = (label ?? providerId).first.map(String.init)?.uppercased() ?? "?"
        return Text(verbatim: initial)
            .font(.system(size: size * 0.5, weight: .semibold, design: .rounded))
            .foregroundStyle(DS.Color.fgMuted)
            .frame(width: size, height: size)
            .background(DS.Color.bgSubtle, in: .rect(cornerRadius: size * 0.225))
            .overlay(
                RoundedRectangle(cornerRadius: size * 0.225)
                    .strokeBorder(DS.Color.border, lineWidth: 1)
            )
    }
}

#Preview("Provider logos") {
    HStack(spacing: 12) {
        ProviderLogoView(providerId: "anthropic", label: "Anthropic", size: 28)
        ProviderLogoView(providerId: "openai", label: "OpenAI", size: 28)
        ProviderLogoView(providerId: "google", label: "Google", size: 28)
        ProviderLogoView(providerId: "opencode", label: "OpenCode", size: 28)
        ProviderLogoView(providerId: "pi", label: "Pi", size: 28)
    }
    .padding()
}
