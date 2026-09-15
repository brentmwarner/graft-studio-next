import SwiftUI

/// Codex-style navigation drawer, layered *under* the main content: the menu
/// column is pinned to the leading edge and the whole projects screen —
/// navigation bar included — slides trailing to reveal it, with an impact
/// haptic on open and close.
struct NavDrawerLayout<Content: View>: View {
    @Binding var isOpen: Bool
    let hostLabel: String
    let isConnected: Bool
    let recentThreads: [InboxThreadItem]
    /// Right-swipe opens the drawer only while the projects root is on
    /// screen — on pushed screens the same motion must stay the interactive
    /// back gesture.
    let canSwipeOpen: Bool
    let onSearch: () -> Void
    let onSelectThread: (InboxThreadItem) -> Void
    let onNewChat: () -> Void
    let onSettings: () -> Void
    let content: Content

    /// How far the content slides — which is also the revealed menu width.
    private let menuWidth: CGFloat = 300

    init(
        isOpen: Binding<Bool>,
        hostLabel: String,
        isConnected: Bool,
        recentThreads: [InboxThreadItem],
        canSwipeOpen: Bool,
        onSearch: @escaping () -> Void,
        onSelectThread: @escaping (InboxThreadItem) -> Void,
        onNewChat: @escaping () -> Void,
        onSettings: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) {
        self._isOpen = isOpen
        self.hostLabel = hostLabel
        self.isConnected = isConnected
        self.recentThreads = recentThreads
        self.canSwipeOpen = canSwipeOpen
        self.onSearch = onSearch
        self.onSelectThread = onSelectThread
        self.onNewChat = onNewChat
        self.onSettings = onSettings
        self.content = content()
    }

    var body: some View {
        ZStack(alignment: .leading) {
            Color(.systemBackground)
                .ignoresSafeArea()

            NavDrawerMenu(
                hostLabel: hostLabel,
                isConnected: isConnected,
                recentThreads: recentThreads,
                onProjects: { isOpen = false },
                onSearch: {
                    isOpen = false
                    onSearch()
                },
                onSelectThread: { thread in
                    isOpen = false
                    onSelectThread(thread)
                },
                onNewChat: {
                    isOpen = false
                    onNewChat()
                },
                onSettings: {
                    isOpen = false
                    onSettings()
                }
            )
            .frame(width: menuWidth, alignment: .leading)
            .allowsHitTesting(isOpen)
            .accessibilityHidden(!isOpen)

            content
                .overlay {
                    if isOpen {
                        DrawerDismissScrim(onDismiss: { isOpen = false })
                    }
                }
                // A mask, not clipShape: clipShape cuts at the safe-area
                // bounds, which amputates the screen's own edge drawing (top
                // fade, composer chrome) and leaves the open card short of the
                // display's top and bottom. The ignoresSafeArea mask spans the
                // full screen, so closed it clips nothing and open the card
                // runs edge to edge.
                .mask {
                    RoundedRectangle(cornerRadius: isOpen ? 34 : 0, style: .continuous)
                        .ignoresSafeArea()
                }
                .shadow(color: .black.opacity(isOpen ? 0.25 : 0), radius: 30, x: -4, y: 0)
                .offset(x: isOpen ? menuWidth : 0)
                .simultaneousGesture(
                    swipeOpen,
                    including: canSwipeOpen && !isOpen ? .all : .subviews
                )
        }
        .animation(.snappy(duration: 0.3), value: isOpen)
        .sensoryFeedback(.impact(weight: .medium), trigger: isOpen)
    }

    /// A decisively horizontal right-drag anywhere on the content — the
    /// standard drawer open gesture, without stealing vertical scrolls.
    private var swipeOpen: some Gesture {
        DragGesture(minimumDistance: 25)
            .onEnded { value in
                let w = value.translation.width
                let h = abs(value.translation.height)
                if w > 60, h < w * 0.6 {
                    isOpen = true
                }
            }
    }
}

/// Invisible layer over the slid-aside screen: tap or swipe it back closed.
private struct DrawerDismissScrim: View {
    let onDismiss: () -> Void

    var body: some View {
        Color.black.opacity(0.02)
            .ignoresSafeArea()
            .contentShape(Rectangle())
            .onTapGesture(perform: onDismiss)
            .gesture(
                DragGesture(minimumDistance: 20)
                    .onEnded { value in
                        if value.translation.width < -30 { onDismiss() }
                    }
            )
            .accessibilityLabel(Text("Close menu", comment: "Dismiss the navigation drawer"))
            .accessibilityAddTraits(.isButton)
    }
}

/// The surface revealed behind the content — a complete navigation column:
/// header with search, destinations, recent threads, and the compose pill
/// with settings pinned to the bottom.
private struct NavDrawerMenu: View {
    let hostLabel: String
    let isConnected: Bool
    let recentThreads: [InboxThreadItem]
    let onProjects: () -> Void
    let onSearch: () -> Void
    let onSelectThread: (InboxThreadItem) -> Void
    let onNewChat: () -> Void
    let onSettings: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Text(verbatim: "Graft")
                    .font(.title2.weight(.bold))
                Spacer(minLength: 0)
                Button(action: onSearch) {
                    Image(systemName: "magnifyingglass")
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                        .frame(width: 40, height: 40)
                        .contentShape(.circle)
                        .glassEffect(.regular.interactive(), in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    Text("Search chats", comment: "Focus the inbox search from the drawer")
                )
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
            .padding(.bottom, 12)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    NavDrawerRow(icon: "folder", title: "Projects", action: onProjects)

                    NavDrawerConnectionRow(hostLabel: hostLabel, isConnected: isConnected)

                    if !recentThreads.isEmpty {
                        Text("Recents", comment: "Drawer section of recently updated threads")
                            .font(.title3.weight(.semibold))
                            .padding(.horizontal, 24)
                            .padding(.top, 26)
                            .padding(.bottom, 4)

                        ForEach(recentThreads) { thread in
                            NavDrawerThreadRow(thread: thread) {
                                onSelectThread(thread)
                            }
                        }
                    }
                }
                .padding(.bottom, 12)
            }
            .scrollIndicators(.hidden)

            HStack(spacing: 12) {
                // Dark liquid glass, matching the home compose button — reads
                // as the one primary action on the drawer.
                Button(action: onNewChat) {
                    HStack(spacing: 8) {
                        Image(systemName: "square.and.pencil")
                            .font(.body.weight(.semibold))
                        Text("Chat", comment: "Drawer compose pill")
                            .font(.body.weight(.semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 24)
                    .frame(height: 48)
                    .contentShape(.capsule)
                    .background { GlassSurface(dark: true, in: .capsule) }
                    .clipShape(.capsule)
                }
                .buttonStyle(PillPress())
                .accessibilityLabel(
                    Text("New chat", comment: "Compose new thread from the drawer")
                )

                Spacer(minLength: 0)

                Button(action: onSettings) {
                    Image(systemName: "gearshape")
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                        .frame(width: 44, height: 44)
                        .contentShape(.circle)
                        .glassEffect(.regular.interactive(), in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    Text("Settings", comment: "Open settings from the drawer")
                )
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 8)
        }
        .frame(maxHeight: .infinity)
    }
}

private struct NavDrawerRow: View {
    let icon: String
    let title: LocalizedStringKey
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.body.weight(.medium))
                    .frame(width: 26)
                Text(title)
                    .font(.body.weight(.medium))
                Spacer(minLength: 0)
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 24)
            .padding(.vertical, 13)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// A recent thread in the drawer: truncated title, PR state glyph when the
/// thread tracks one, attention dot when live.
private struct NavDrawerThreadRow: View {
    let thread: InboxThreadItem
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Text(thread.title)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
                if let pr = thread.pr {
                    PrStateGlyph(state: pr.state)
                        .accessibilityLabel(pr.state.accessibilityLabel)
                }
                if thread.showsAttentionDot {
                    Circle()
                        .fill(Color.accentColor)
                        .frame(width: 8, height: 8)
                        .accessibilityLabel(
                            Text("Needs attention", comment: "Unread/active thread indicator")
                        )
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(
            Text("Open thread", comment: "Accessibility hint for a drawer recent thread")
        )
    }
}

/// GitHub's pull-request octicons, path-drawn: rail-and-elbow for open-ish
/// states, the branch-and-node for merged, an X atop the rail for closed —
/// tinted with GitHub's semantic state colors.
struct PrStateGlyph: View {
    let state: ThreadPrState

    var body: some View {
        Canvas { context, size in
            let scale = min(size.width, size.height) / 16
            let stroke = StrokeStyle(lineWidth: 1.7 * scale, lineCap: .round)

            func ring(_ x: CGFloat, _ y: CGFloat) {
                let radius = 2.1 * scale
                let rect = CGRect(
                    x: x * scale - radius,
                    y: y * scale - radius,
                    width: radius * 2,
                    height: radius * 2
                )
                context.stroke(Path(ellipseIn: rect), with: .color(color), style: stroke)
            }

            func line(_ points: [(CGFloat, CGFloat)], dashed: Bool = false) {
                var path = Path()
                path.move(to: CGPoint(x: points[0].0 * scale, y: points[0].1 * scale))
                for point in points.dropFirst() {
                    path.addLine(to: CGPoint(x: point.0 * scale, y: point.1 * scale))
                }
                var style = stroke
                if dashed { style.dash = [0.1 * scale, 3.2 * scale] }
                context.stroke(path, with: .color(color), style: style)
            }

            // Left rail: top ring, stem, bottom ring — shared by every state.
            ring(3.5, 3.5)
            line([(3.5, 6.2), (3.5, 9.8)])
            ring(3.5, 12.5)

            switch state {
            case .open, .changesRequested, .draft:
                // Elbow from the top ring over to the right rail.
                var elbow = Path()
                elbow.move(to: CGPoint(x: 6.2 * scale, y: 3.5 * scale))
                elbow.addLine(to: CGPoint(x: 10.4 * scale, y: 3.5 * scale))
                elbow.addQuadCurve(
                    to: CGPoint(x: 12.5 * scale, y: 5.6 * scale),
                    control: CGPoint(x: 12.5 * scale, y: 3.5 * scale)
                )
                context.stroke(elbow, with: .color(color), style: stroke)
                line([(12.5, 6.4), (12.5, 9.8)], dashed: state == .draft)
                ring(12.5, 12.5)
            case .merged:
                // Branch curving out of the stem into the merge node.
                var branch = Path()
                branch.move(to: CGPoint(x: 3.5 * scale, y: 6.2 * scale))
                branch.addQuadCurve(
                    to: CGPoint(x: 9.8 * scale, y: 9.4 * scale),
                    control: CGPoint(x: 6.4 * scale, y: 9.2 * scale)
                )
                context.stroke(branch, with: .color(color), style: stroke)
                ring(12.2, 9.4)
            case .closed:
                line([(10.4, 2.6), (14.2, 6.4)])
                line([(14.2, 2.6), (10.4, 6.4)])
                line([(12.5, 8.6), (12.5, 9.8)])
                ring(12.5, 12.5)
            }
        }
        .frame(width: 15, height: 15)
    }

    private var color: Color {
        switch state {
        case .open:
            Color(UIColor { trait in
                trait.userInterfaceStyle == .dark
                    ? UIColor(red: 0.25, green: 0.73, blue: 0.31, alpha: 1)
                    : UIColor(red: 0.10, green: 0.50, blue: 0.22, alpha: 1)
            })
        case .draft:
            Color(.secondaryLabel)
        case .changesRequested:
            Color(UIColor { trait in
                trait.userInterfaceStyle == .dark
                    ? UIColor(red: 0.82, green: 0.60, blue: 0.13, alpha: 1)
                    : UIColor(red: 0.60, green: 0.40, blue: 0.00, alpha: 1)
            })
        case .merged:
            Color(UIColor { trait in
                trait.userInterfaceStyle == .dark
                    ? UIColor(red: 0.64, green: 0.44, blue: 0.97, alpha: 1)
                    : UIColor(red: 0.51, green: 0.31, blue: 0.87, alpha: 1)
            })
        case .closed:
            Color(UIColor { trait in
                trait.userInterfaceStyle == .dark
                    ? UIColor(red: 0.97, green: 0.32, blue: 0.29, alpha: 1)
                    : UIColor(red: 0.81, green: 0.13, blue: 0.18, alpha: 1)
            })
        }
    }
}

extension ThreadPrState {
    /// VoiceOver label for the PR badge.
    var accessibilityLabel: Text {
        switch self {
        case .open:
            Text("Pull request open", comment: "PR badge state")
        case .draft:
            Text("Draft pull request", comment: "PR badge state")
        case .changesRequested:
            Text("Pull request has changes requested", comment: "PR badge state")
        case .merged:
            Text("Pull request merged", comment: "PR badge state")
        case .closed:
            Text("Pull request closed", comment: "PR badge state")
        }
    }
}

/// The "connected things": which Studio this phone is paired to, and whether
/// the socket is live right now.
private struct NavDrawerConnectionRow: View {
    let hostLabel: String
    let isConnected: Bool

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "laptopcomputer")
                .font(.body.weight(.medium))
                .frame(width: 26)
            Text(verbatim: hostLabel)
                .font(.body.weight(.medium))
                .lineLimit(1)
            Spacer(minLength: 0)
            Circle()
                .fill(isConnected ? Color.green : Color.secondary)
                .frame(width: 8, height: 8)
        }
        .foregroundStyle(.primary)
        .padding(.horizontal, 24)
        .padding(.vertical, 13)
        .accessibilityElement(children: .combine)
        .accessibilityValue(
            Text(
                isConnected ? "Connected" : "Disconnected",
                comment: "Drawer connection status"
            )
        )
    }
}

#Preview {
    @Previewable @State var isOpen = true
    NavDrawerLayout(
        isOpen: $isOpen,
        hostLabel: "MacBook-Pro-2.local",
        isConnected: true,
        recentThreads: [
            InboxThreadItem(
                id: "t1",
                title: "Audit Graft against competing tools",
                showsAttentionDot: true,
                pr: ThreadPrInfo(number: 201, state: .open)
            ),
            InboxThreadItem(
                id: "t2",
                title: "Polish remote inbox hierarchy with a very long name",
                showsAttentionDot: false,
                pr: ThreadPrInfo(number: 195, state: .merged)
            ),
            InboxThreadItem(
                id: "t9",
                title: "Wire approval prompts on mobile",
                showsAttentionDot: false,
                pr: ThreadPrInfo(number: 188, state: .changesRequested)
            ),
            InboxThreadItem(
                id: "t4",
                title: "Spike drag to reorder",
                showsAttentionDot: false,
                pr: ThreadPrInfo(number: 168, state: .draft)
            ),
            InboxThreadItem(
                id: "t5",
                title: "Legacy onboarding pass",
                showsAttentionDot: false,
                pr: ThreadPrInfo(number: 90, state: .closed)
            ),
        ],
        canSwipeOpen: true,
        onSearch: {},
        onSelectThread: { _ in },
        onNewChat: {},
        onSettings: {}
    ) {
        NavigationStack {
            List(0..<12, id: \.self) { index in
                Text(verbatim: "Row \(index)")
            }
            .navigationTitle(Text(verbatim: "Projects"))
        }
    }
}
