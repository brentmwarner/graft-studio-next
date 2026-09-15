import SwiftUI

/// Official Graft mark — the studio glyph, with no disc or circle container.
/// Ink follows the theme: black in light mode, white in dark.
struct GraftMark: View {
    var size: CGFloat = 72

    var body: some View {
        Image("GraftMark")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .foregroundStyle(DS.Color.fg)
            .frame(width: size, height: size)
            .accessibilityLabel(Text("Graft", comment: "Accessibility label for the official brand mark"))
            .accessibilityAddTraits(.isImage)
    }
}

#Preview("Light") {
    GraftMark()
        .padding()
        .preferredColorScheme(.light)
}

#Preview("Dark") {
    GraftMark()
        .padding()
        .preferredColorScheme(.dark)
}
