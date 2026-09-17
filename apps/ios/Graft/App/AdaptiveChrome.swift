import SwiftUI

/// Size-class and window-width policy for the native home/chat chrome.
///
/// Compact (iPhone, iPad Slide Over) keeps the existing drawer + stack.
/// Regular horizontal (iPad) floats an inset glass panel over the chat canvas.
/// Wide windows reserve room beside it; narrower windows use an overlay.
enum AdaptiveChrome {
    /// Chat/composer column cap so wide regular-width panes do not stretch
    /// prose and the composer across the full detail column.
    static let readableColumnMaxWidth: CGFloat = 720

    static let sidebarIdealWidth: CGFloat = 320
    static let sidebarMargin: CGFloat = 16
    static let sidebarCornerRadius: CGFloat = 28

    /// Pin both columns when the window can keep a readable chat pane beside
    /// the ideal sidebar. iPad landscape (and 13-inch portrait) qualify;
    /// Mini / 11-inch portrait keep the full chat width behind the overlay.
    static let pinnedSidebarMinimumWidth: CGFloat = 900

    /// Full-screen iPad window widths used by tests and review notes.
    enum Canvas {
        static let iPadMiniPortrait: CGFloat = 744
        static let iPadMiniLandscape: CGFloat = 1_133
        static let iPad11Portrait: CGFloat = 834
        static let iPad11Landscape: CGFloat = 1_194
        static let iPad13Portrait: CGFloat = 1_024
        static let iPad13Landscape: CGFloat = 1_366
    }

    static func usesPersistentSidebar(
        horizontalSizeClass: UserInterfaceSizeClass?
    ) -> Bool {
        horizontalSizeClass == .regular
    }

    static func canPinSidebar(containerWidth: CGFloat) -> Bool {
        containerWidth >= pinnedSidebarMinimumWidth
    }

    static func sidebarWidth(in containerWidth: CGFloat) -> CGFloat {
        min(sidebarIdealWidth, max(containerWidth - 2 * sidebarMargin, 0))
    }

    struct SidebarPresentation {
        var isVisible = true
        var prefersPinned = true

        func isPinned(in containerWidth: CGFloat) -> Bool {
            isVisible && prefersPinned && canPinSidebar(containerWidth: containerWidth)
        }

        func chatLeadingInset(in containerWidth: CGFloat) -> CGFloat {
            isPinned(in: containerWidth) ? sidebarWidth(in: containerWidth) + 2 * sidebarMargin : 0
        }

        mutating func didSelectDestination(in containerWidth: CGFloat) {
            if !isPinned(in: containerWidth) {
                isVisible = false
            }
        }
    }

    /// Caps at `readableColumnMaxWidth` only when both columns are pinned.
    /// Overlay / compact widths keep the full container so Mini and 11-inch
    /// portrait are not inset to 720 inside an already-narrow pane.
    static func readableColumnWidth(in containerWidth: CGFloat) -> CGFloat {
        let width = max(containerWidth, 0)
        guard canPinSidebar(containerWidth: width) else { return width }
        return min(width, readableColumnMaxWidth)
    }

    /// The floating panel owns its glass background. Only the compact inbox
    /// paints over the phone drawer.
    static func paintsOpaqueInboxBackground(usesPersistentSidebar: Bool) -> Bool {
        !usesPersistentSidebar
    }
}

extension View {
    /// Centers chat chrome in a readable column on pinned wide surfaces.
    /// Overlay and compact widths use the full container (no 720 cap).
    func readableChatColumn() -> some View {
        containerRelativeFrame(.horizontal, alignment: .center) { length, _ in
            AdaptiveChrome.readableColumnWidth(in: length)
        }
    }
}
