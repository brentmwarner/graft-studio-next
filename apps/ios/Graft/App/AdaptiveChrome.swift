import SwiftUI

/// Size-class and window-width policy for the native home/chat chrome.
///
/// Compact (iPhone, iPad Slide Over) keeps the existing drawer + stack.
/// Regular horizontal (iPad) uses `NavigationSplitView` in both orientations:
/// landscape pins sidebar + chat; narrower portrait lets the sidebar overlay
/// so the chat column stays usable.
enum AdaptiveChrome {
    /// Chat/composer column cap so wide regular-width panes do not stretch
    /// prose and the composer across the full detail column.
    static let readableColumnMaxWidth: CGFloat = 720

    static let sidebarMinWidth: CGFloat = 280
    static let sidebarIdealWidth: CGFloat = 320
    static let sidebarMaxWidth: CGFloat = 400

    /// Pin both columns when the window can keep a readable chat pane beside
    /// the ideal sidebar. iPad landscape (and 13-inch portrait) qualify;
    /// Mini / 11-inch portrait stay automatic so the sidebar can overlay.
    static let pinnedSplitMinimumWidth: CGFloat = 900

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

    static func prefersPinnedSplit(containerWidth: CGFloat) -> Bool {
        containerWidth >= pinnedSplitMinimumWidth
    }

    static func preferredColumnVisibility(
        containerWidth: CGFloat
    ) -> NavigationSplitViewVisibility {
        prefersPinnedSplit(containerWidth: containerWidth) ? .all : .automatic
    }

    static func remainingChatWidth(
        containerWidth: CGFloat,
        sidebarWidth: CGFloat = sidebarIdealWidth
    ) -> CGFloat {
        max(containerWidth - sidebarWidth, 0)
    }

    /// Caps at `readableColumnMaxWidth` only when both columns are pinned.
    /// Overlay / compact widths keep the full container so Mini and 11-inch
    /// portrait are not inset to 720 inside an already-narrow pane.
    static func readableColumnWidth(in containerWidth: CGFloat) -> CGFloat {
        let width = max(containerWidth, 0)
        guard prefersPinnedSplit(containerWidth: width) else { return width }
        return min(width, readableColumnMaxWidth)
    }

    /// The split view owns its sidebar material, including OS and accessibility
    /// adaptations. Only the compact inbox paints over the phone drawer.
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
