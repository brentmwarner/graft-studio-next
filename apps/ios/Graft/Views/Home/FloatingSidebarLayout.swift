import SwiftUI

/// Regular-width navigation floats above a full-bleed chat canvas. The panel
/// geometry is app-owned so OS split-column appearance cannot remove its inset.
struct FloatingSidebarLayout<Sidebar: View, Detail: View>: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var presentation = AdaptiveChrome.SidebarPresentation()

    let hostLabel: String
    let isConnected: Bool
    let selectionID: UUID
    let onSettings: () -> Void
    let onMore: () -> Void
    @ViewBuilder var sidebar: Sidebar
    @ViewBuilder var detail: Detail

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let isPinned = presentation.isPinned(in: width)

            ZStack(alignment: .leading) {
                Color(.systemBackground)
                    .ignoresSafeArea()

                NavigationStack {
                    detail
                        .toolbar {
                            if !presentation.isVisible {
                                ToolbarItem(placement: .topBarLeading) {
                                    Button("Show Projects", systemImage: "sidebar.left") {
                                        presentation.isVisible = true
                                    }
                                    .accessibilityIdentifier("show-projects-sidebar")
                                }
                            }
                        }
                }
                .padding(.leading, presentation.chatLeadingInset(in: width))
                .accessibilityHidden(presentation.isVisible && !isPinned)

                if presentation.isVisible && !isPinned {
                    Button {
                        presentation.isVisible = false
                    } label: {
                        Color.black.opacity(0.06)
                            .ignoresSafeArea()
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Dismiss Projects")
                    .accessibilityIdentifier("dismiss-projects-overlay")
                }

                if presentation.isVisible {
                    FloatingProjectsPanel(
                        hostLabel: hostLabel,
                        isConnected: isConnected,
                        isPinned: isPinned,
                        canPin: AdaptiveChrome.canPinSidebar(containerWidth: width),
                        onTogglePin: { presentation.prefersPinned.toggle() },
                        onClose: { presentation.isVisible = false },
                        onSettings: onSettings,
                        onMore: onMore
                    ) {
                        sidebar
                    }
                    .frame(width: AdaptiveChrome.sidebarWidth(in: width))
                    .padding(AdaptiveChrome.sidebarMargin)
                    .transition(reduceMotion ? .opacity : .move(edge: .leading).combined(with: .opacity))
                }
            }
            .animation(reduceMotion ? nil : .snappy(duration: 0.3), value: presentation.isVisible)
            .animation(reduceMotion ? nil : .snappy(duration: 0.3), value: presentation.prefersPinned)
            .onChange(of: selectionID) {
                presentation.didSelectDestination(in: width)
            }
            .onChange(of: AdaptiveChrome.canPinSidebar(containerWidth: width)) { _, canPin in
                // Returning to a wide window restores a previously pinned panel.
                if canPin && presentation.prefersPinned {
                    presentation.isVisible = true
                }
            }
        }
    }
}

private struct FloatingProjectsPanel<Content: View>: View {
    let hostLabel: String
    let isConnected: Bool
    let isPinned: Bool
    let canPin: Bool
    let onTogglePin: () -> Void
    let onClose: () -> Void
    let onSettings: () -> Void
    let onMore: () -> Void
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) {
            FloatingProjectsHeader(
                hostLabel: hostLabel,
                isConnected: isConnected,
                isPinned: isPinned,
                canPin: canPin,
                onTogglePin: onTogglePin,
                onClose: onClose,
                onSettings: onSettings,
                onMore: onMore
            )

            // Clip only the scrolling region: rows never pass under the header.
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
        }
        .clipShape(RoundedRectangle(cornerRadius: AdaptiveChrome.sidebarCornerRadius, style: .continuous))
        .background {
            // Glass samples the canvas behind this shape. The title and rows
            // remain foreground siblings, outside all navigation-bar effects.
            RoundedRectangle(cornerRadius: AdaptiveChrome.sidebarCornerRadius, style: .continuous)
                .fill(.clear)
                .glassEffect(.regular, in: RoundedRectangle(
                    cornerRadius: AdaptiveChrome.sidebarCornerRadius,
                    style: .continuous
                ))
                .shadow(color: .black.opacity(0.12), radius: 24, x: 0, y: 8)
        }
        .accessibilityIdentifier("floating-projects-panel")
    }
}

private struct FloatingProjectsHeader: View {
    let hostLabel: String
    let isConnected: Bool
    let isPinned: Bool
    let canPin: Bool
    let onTogglePin: () -> Void
    let onClose: () -> Void
    let onSettings: () -> Void
    let onMore: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            InboxTitleLockup(hostLabel: hostLabel, isConnected: isConnected, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("projects-sidebar-title")

            Menu {
                Button("Settings", systemImage: "gearshape", action: onSettings)
                Button("Environment", systemImage: "desktopcomputer", action: onMore)
            } label: {
                Image(systemName: "ellipsis")
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Projects options")

            if canPin {
                Button(action: onTogglePin) {
                    Image(systemName: isPinned ? "pin.fill" : "pin")
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(isPinned ? "Unpin Projects" : "Pin Projects")
                .accessibilityIdentifier("pin-projects-sidebar")
            }

            Button(action: onClose) {
                Image(systemName: "sidebar.left")
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Hide Projects")
            .accessibilityIdentifier("hide-projects-sidebar")
        }
        .font(.body.weight(.medium))
        .foregroundStyle(.primary)
        .buttonStyle(.plain)
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .padding(.vertical, 12)
    }
}
