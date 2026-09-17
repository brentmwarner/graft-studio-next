import SwiftUI

/// Size-class and window-width policy for the native home/chat chrome.
///
/// Compact (iPhone, iPad Slide Over) keeps the existing drawer + stack.
/// Regular horizontal (iPad) floats an inset glass panel over the chat canvas.
/// Chat always reserves room beside the visible panel.
enum AdaptiveChrome {
    /// Chat/composer column cap so wide regular-width panes do not stretch
    /// prose and the composer across the full detail column.
    static let readableColumnMaxWidth: CGFloat = 720

    static let sidebarIdealWidth: CGFloat = 320
    static let sidebarMargin: CGFloat = 16
    static let sidebarCornerRadius: CGFloat = 28

    /// Apply the readable-column cap only to wide chat containers.
    static let readableColumnMinimumContainerWidth: CGFloat = 900

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

    static func sidebarWidth(in containerWidth: CGFloat) -> CGFloat {
        min(sidebarIdealWidth, max(containerWidth - 2 * sidebarMargin, 0))
    }

    struct SidebarPresentation {
        var isVisible = true

        func chatLeadingInset(in containerWidth: CGFloat) -> CGFloat {
            guard isVisible else { return 0 }
            return min(max(containerWidth, 0), sidebarWidth(in: containerWidth) + 2 * sidebarMargin)
        }
    }

    /// Wide chat containers cap at `readableColumnMaxWidth`; narrower panes
    /// keep their full available width, including compact phone layouts.
    static func readableColumnWidth(in containerWidth: CGFloat) -> CGFloat {
        let width = max(containerWidth, 0)
        guard width >= readableColumnMinimumContainerWidth else { return width }
        return min(width, readableColumnMaxWidth)
    }

    /// The floating panel owns its glass background. Only the compact inbox
    /// paints over the phone drawer.
    static func paintsOpaqueInboxBackground(usesPersistentSidebar: Bool) -> Bool {
        !usesPersistentSidebar
    }
}

extension View {
    /// Centers chat chrome in a readable column on wide surfaces.
    /// Narrow and compact widths use the full container (no 720 cap).
    func readableChatColumn() -> some View {
        containerRelativeFrame(.horizontal, alignment: .center) { length, _ in
            AdaptiveChrome.readableColumnWidth(in: length)
        }
    }
}
