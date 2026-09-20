import SwiftUI

/// Regular-width navigation floats Projects over one continuous chat canvas.
/// Content reserves room with safe-area padding; the navigation canvas stays full width.
struct FloatingSidebarLayout<Sidebar: View, Detail: View>: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var presentation = AdaptiveChrome.SidebarPresentation()

    let hostLabel: String
    let isConnected: Bool
    let onSettings: () -> Void
    @Binding var viewMode: InboxViewMode
    @ViewBuilder var sidebar: Sidebar
    @ViewBuilder var detail: Detail

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width

            ZStack(alignment: .leading) {
                NavigationStack {
                    detail
                        // Reserve content space without exposing a separate canvas.
                        .safeAreaPadding(.leading, presentation.chatLeadingInset(in: width))
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
                .environment(\.chatLeadingInset, presentation.chatLeadingInset(in: width))

                if presentation.isVisible {
                    FloatingProjectsPanel(
                        hostLabel: hostLabel,
                        isConnected: isConnected,
                        onClose: { presentation.isVisible = false },
                        onSettings: onSettings,
                        viewMode: $viewMode
                    ) {
                        sidebar
                    }
                    .frame(width: AdaptiveChrome.sidebarWidth(in: width))
                    .padding(AdaptiveChrome.sidebarMargin)
                    .transition(reduceMotion ? .opacity : .move(edge: .leading).combined(with: .opacity))
                }
            }
            .animation(reduceMotion ? nil : .snappy(duration: 0.3), value: presentation.isVisible)
        }
    }
}

private struct FloatingProjectsPanel<Content: View>: View {
    let hostLabel: String
    let isConnected: Bool
    let onClose: () -> Void
    let onSettings: () -> Void
    @Binding var viewMode: InboxViewMode
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) {
            FloatingProjectsHeader(
                hostLabel: hostLabel,
                isConnected: isConnected,
                onClose: onClose,
                onSettings: onSettings,
                viewMode: $viewMode
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
        }
        .accessibilityIdentifier("floating-projects-panel")
    }
}

private struct FloatingProjectsHeader: View {
    let hostLabel: String
    let isConnected: Bool
    let onClose: () -> Void
    let onSettings: () -> Void
    @Binding var viewMode: InboxViewMode

    var body: some View {
        HStack(spacing: 0) {
            InboxTitleLockup(hostLabel: hostLabel, isConnected: isConnected, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("projects-sidebar-title")

            Menu {
                InboxViewOptions(selection: $viewMode)
                Divider()
                Button("Settings", systemImage: "gearshape", action: onSettings)
            } label: {
                Image(systemName: "ellipsis")
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Projects options")

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
