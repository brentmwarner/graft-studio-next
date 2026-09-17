import SwiftUI

/// Size-class policy for the native home/chat chrome.
///
/// Compact (iPhone, iPad Slide Over) keeps the existing drawer + stack.
/// Regular horizontal (iPad, plus-size landscape) uses a persistent split.
enum AdaptiveChrome {
    /// Chat/composer column cap so wide regular-width panes do not stretch
    /// prose and the composer across the full detail column.
    static let readableColumnMaxWidth: CGFloat = 720

    static let sidebarMinWidth: CGFloat = 280
    static let sidebarIdealWidth: CGFloat = 320
    static let sidebarMaxWidth: CGFloat = 400

    static func usesPersistentSidebar(
        horizontalSizeClass: UserInterfaceSizeClass?
    ) -> Bool {
        horizontalSizeClass == .regular
    }

    static func readableColumnWidth(in containerWidth: CGFloat) -> CGFloat {
        min(max(containerWidth, 0), readableColumnMaxWidth)
    }
}

extension View {
    /// Centers chat chrome in a readable column on wide surfaces. Compact
    /// widths are unchanged because they are already below the cap.
    func readableChatColumn() -> some View {
        frame(maxWidth: AdaptiveChrome.readableColumnMaxWidth)
            .frame(maxWidth: .infinity)
    }
}
