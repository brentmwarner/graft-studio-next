import SwiftUI

/// Remote inbox — project hierarchy matching the Graft Mobile product surface
/// (hierarchical remote projects list), not the Fetch chat home.
struct HomeView: View {
    @Environment(AppModel.self) private var app
    @State private var searchText = ""
    @State private var collapsedProjectIds: Set<String> = []
    @State private var showOverflow = false
    @State private var showDrawer = false
    @State private var showSettings = false
    @State private var selectedThread: InboxThreadItem?
    @State private var newChatContext: NewChatContext?
    @FocusState private var searchFieldFocused: Bool

    var body: some View {
        let projects = InboxGrouping.projects(
            from: app.snapshot,
            searchQuery: searchText
        )
        // The drawer sits under the NavigationStack: opening it slides the
        // whole projects screen — nav bar included — aside to reveal the menu.
        NavDrawerLayout(
            isOpen: $showDrawer,
            hostLabel: hostLabel,
            isConnected: app.gateway.state == .connected,
            recentThreads: InboxGrouping.recentThreads(from: app.snapshot),
            canSwipeOpen: selectedThread == nil && newChatContext == nil,
            onSearch: {
                // Let the card land before raising the keyboard.
                Task {
                    try? await Task.sleep(for: .seconds(0.35))
                    searchFieldFocused = true
                }
            },
            onSelectThread: { selectedThread = $0 },
            onNewChat: { newChatContext = NewChatContext() },
            onSettings: { showSettings = true }
        ) {
            NavigationStack {
                ZStack(alignment: .bottom) {
                    RemoteInboxScreen(
                        projects: projects,
                        isLoading: app.snapshot == nil && app.isPaired,
                        collapsedProjectIds: $collapsedProjectIds,
                        onToggleProject: { id in
                            if collapsedProjectIds.contains(id) {
                                collapsedProjectIds.remove(id)
                            } else {
                                collapsedProjectIds.insert(id)
                            }
                        },
                        onSelectThread: { selectedThread = $0 },
                        onComposeInProject: {
                            newChatContext = NewChatContext(preselectedProjectId: $0)
                        },
                        onRefresh: { app.reconnectIfNeeded() }
                    )

                    RemoteInboxBottomBar(
                        searchText: $searchText,
                        searchFocused: $searchFieldFocused,
                        onCompose: { newChatContext = NewChatContext() }
                    )
                    .padding(.horizontal, 16)
                    .padding(.bottom, 10)

                    if let error = app.gatewayError {
                        VStack {
                            Spacer()
                            HomeGatewayErrorBanner(message: homeErrorMessage(error))
                                .padding(.bottom, 72)
                        }
                    }
                }
                // Native bar: the iOS scroll-edge fade only comes from real
                // toolbar items over scrolling content, not a custom header row.
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    // The bar renders in a UIKit layer the drawer's clip shape
                    // can't touch, so the button's glass platter would ride
                    // proud of the card's rounded corner while slid aside —
                    // drop the platter (keeping the glyph) whenever the drawer
                    // is open.
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            showDrawer = true
                        } label: {
                            Image(systemName: "line.3.horizontal")
                        }
                        .accessibilityLabel(Text("Menu", comment: "Open navigation drawer"))
                    }
                    .sharedBackgroundVisibility(showDrawer ? .hidden : .automatic)
                    ToolbarItem(placement: .principal) {
                        InboxTitleLockup(
                            hostLabel: hostLabel,
                            isConnected: app.gateway.state == .connected
                        )
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showOverflow = true
                        } label: {
                            Image(systemName: "ellipsis")
                        }
                        .accessibilityLabel(Text("More", comment: "Open overflow menu"))
                    }
                }
                .navigationDestination(item: $selectedThread) { thread in
                    ThreadView(threadId: thread.id, title: thread.title)
                }
                .navigationDestination(item: $newChatContext) { context in
                    NewChatView(preselectedProjectId: context.preselectedProjectId)
                }
                .confirmationDialog(
                    "Environment",
                    isPresented: $showOverflow,
                    titleVisibility: .visible
                ) {
                    Button("Disconnect", role: .destructive) {
                        Task { await app.unpair() }
                    }
                    Button("Cancel", role: .cancel) {}
                }
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
    }

    private var hostLabel: String {
        if let label = app.connection.session?.environmentLabel, !label.isEmpty {
            return label
        }
        return "Studio"
    }
}

/// Pushes the new-chat screen; carries the optional project the compose came
/// from (project pencil rows preselect, the bottom-bar pencil doesn't).
struct NewChatContext: Identifiable, Hashable {
    let id = UUID()
    var preselectedProjectId: String?
}

/// Inline two-line bar title: screen name over connection state.
struct InboxTitleLockup: View {
    let hostLabel: String
    let isConnected: Bool

    var body: some View {
        VStack(spacing: 2) {
            Text("Projects", comment: "Remote inbox navigation title")
                .font(.headline.weight(.semibold))
            HStack(spacing: 6) {
                Circle()
                    .fill(isConnected ? Color.green : Color.secondary)
                    .frame(width: 7, height: 7)
                Text(verbatim: hostLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Screen

struct RemoteInboxScreen: View {
    let projects: [InboxProjectGroup]
    let isLoading: Bool
    @Binding var collapsedProjectIds: Set<String>
    let onToggleProject: (String) -> Void
    let onSelectThread: (InboxThreadItem) -> Void
    let onComposeInProject: (String) -> Void
    let onRefresh: () -> Void

    var body: some View {
        Group {
            if isLoading {
                HomeConnectingPlaceholder()
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if projects.isEmpty {
                            ContentUnavailableView(
                                "No projects yet",
                                systemImage: "folder",
                                description: Text(
                                    "Open a project in Graft Studio to see it here.",
                                    comment: "Empty remote inbox guidance"
                                )
                            )
                            .padding(.top, 48)
                        } else {
                            ForEach(projects) { project in
                                RemoteProjectSection(
                                    name: project.name,
                                    threads: project.threads,
                                    isExpanded: !collapsedProjectIds.contains(project.id),
                                    onToggle: { onToggleProject(project.id) },
                                    onCompose: { onComposeInProject(project.id) },
                                    onSelectThread: onSelectThread
                                )
                            }
                        }
                    }
                    .padding(.top, 8)
                    .padding(.bottom, 120)
                }
                .refreshable { onRefresh() }
            }
        }
        .background(Color(.systemBackground))
    }
}

// MARK: - Project section

struct RemoteProjectSection: View {
    let name: String
    let threads: [InboxThreadItem]
    let isExpanded: Bool
    let onToggle: () -> Void
    let onCompose: () -> Void
    let onSelectThread: (InboxThreadItem) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RemoteProjectHeaderRow(
                name: name,
                isExpanded: isExpanded,
                onToggle: onToggle,
                onCompose: onCompose
            )

            if isExpanded {
                ForEach(threads) { thread in
                    RemoteThreadRow(
                        title: thread.title,
                        showsAttentionDot: thread.showsAttentionDot,
                        action: { onSelectThread(thread) }
                    )
                }
            }
        }
        .padding(.bottom, 10)
    }
}

struct RemoteProjectHeaderRow: View {
    let name: String
    let isExpanded: Bool
    let onToggle: () -> Void
    let onCompose: () -> Void

    var body: some View {
        // The compose glyph must be its own button — nested inside the toggle
        // it just collapses the folder.
        HStack(spacing: 10) {
            Button(action: onToggle) {
                HStack(spacing: 10) {
                    FolderIcon(isOpen: isExpanded)
                        .foregroundStyle(.primary)
                        .frame(width: 22)

                    Text(name)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(isExpanded ? 0 : -90))

                    Spacer(minLength: 8)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(name))
            .accessibilityHint(
                Text(
                    isExpanded ? "Collapse project" : "Expand project",
                    comment: "Accessibility hint for project disclosure"
                )
            )

            Button(action: onCompose) {
                Image(systemName: "square.and.pencil")
                    .font(.body)
                    .foregroundStyle(.primary)
                    .opacity(0.85)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                Text("New chat in \(name)", comment: "Compose a thread in this project")
            )
        }
        .padding(.leading, 20)
        .padding(.trailing, 14)
        .padding(.vertical, 8)
    }
}

/// Folder disclosure glyph. SF Symbols ships no `folder.open`, so the
/// expanded state draws its own open-folder outline in SF's stroke style.
struct FolderIcon: View {
    let isOpen: Bool

    var body: some View {
        if isOpen {
            OpenFolderGlyph()
                .stroke(style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                .frame(width: 21, height: 17)
        } else {
            Image(systemName: "folder")
                .font(.body)
        }
    }
}

/// Back panel (tab + top edge) plus a tilted front flap — the classic
/// open-folder silhouette, drawn in a 24×20 design space.
struct OpenFolderGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(
                x: rect.minX + x / 24 * rect.width,
                y: rect.minY + y / 20 * rect.height
            )
        }
        var p = Path()
        // Back panel — only the edges the flap doesn't cover.
        p.move(to: pt(2, 15.2))
        p.addLine(to: pt(2, 4.4))
        p.addQuadCurve(to: pt(3.6, 2.8), control: pt(2, 2.8))
        p.addLine(to: pt(8.4, 2.8))
        p.addLine(to: pt(10.1, 4.7))
        p.addLine(to: pt(18.2, 4.7))
        p.addQuadCurve(to: pt(19.8, 6.3), control: pt(19.8, 4.7))
        p.addLine(to: pt(19.8, 7.2))
        // Front flap, mouth opening to the right.
        p.move(to: pt(2, 16.4))
        p.addLine(to: pt(6.1, 7.2))
        p.addLine(to: pt(22.6, 7.2))
        p.addLine(to: pt(18.9, 16.4))
        p.closeSubpath()
        return p
    }
}

struct RemoteThreadRow: View {
    let title: String
    let showsAttentionDot: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Text(title)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .truncationMode(.tail)

                Spacer(minLength: 8)

                if showsAttentionDot {
                    Circle()
                        .fill(Color.accentColor)
                        .frame(width: 8, height: 8)
                        .accessibilityLabel(
                            Text("Needs attention", comment: "Unread/active thread indicator")
                        )
                }
            }
            .padding(.leading, 52)
            .padding(.trailing, 20)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint(
            Text("Open thread", comment: "Accessibility hint for a remote thread row")
        )
    }
}

// MARK: - Bottom bar

struct RemoteInboxBottomBar: View {
    @Binding var searchText: String
    var searchFocused: FocusState<Bool>.Binding
    let onCompose: () -> Void

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)
                    TextField(
                        "Search Chats",
                        text: $searchText,
                        prompt: Text("Search Chats", comment: "Remote inbox search placeholder")
                    )
                    .focused(searchFocused)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .glassEffect(.regular.interactive(), in: .capsule)

                // Sign-in pill's dark liquid glass, in circle form — reads as
                // the one primary action on the bar.
                Button(action: onCompose) {
                    Image(systemName: "square.and.pencil")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(width: 48, height: 48)
                        .contentShape(.circle)
                        .background { GlassSurface(dark: true, in: .circle) }
                        .clipShape(.circle)
                }
                .buttonStyle(PillPress())
                .accessibilityLabel(
                    Text("New chat", comment: "Compose new thread from remote inbox")
                )
            }
        }
    }
}

// MARK: - Shared chrome

struct HomeConnectingPlaceholder: View {
    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text(
                "Connecting to Studio…",
                comment: "Placeholder while the gateway snapshot loads"
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct HomeGatewayErrorBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.yellow)
            Text(message)
                .font(.caption)
                .lineLimit(2)
        }
        .padding(12)
        .glassEffect(.regular, in: .rect(cornerRadius: 12))
        .padding(.horizontal)
        .accessibilityElement(children: .combine)
    }
}

private func homeErrorMessage(_ error: GraftError) -> String {
    switch error {
    case .hostError(_, let message, _):
        return message
    case .unauthorized:
        return String(localized: "Session expired — re-pair to reconnect.")
    default:
        return error.localizedDescription
    }
}

#Preview("Remote inbox") {
    @Previewable @FocusState var searchFocused: Bool
    let projects = [
        InboxProjectGroup(
            id: "1",
            name: "graft-studio",
            threads: [
                InboxThreadItem(id: "t1", title: "Audit Graft identity coverage", showsAttentionDot: true),
                InboxThreadItem(id: "t2", title: "Audit capability coverage for Graft", showsAttentionDot: false),
                InboxThreadItem(id: "t9", title: "Plan Graft Mobile remote access", showsAttentionDot: false),
            ]
        ),
        InboxProjectGroup(
            id: "2",
            name: "graft",
            threads: [
                InboxThreadItem(id: "t4", title: "Polish remote inbox hierarchy", showsAttentionDot: false),
                InboxThreadItem(id: "t5", title: "Wire approval prompts on mobile", showsAttentionDot: false),
            ]
        ),
    ]

    NavigationStack {
        ZStack(alignment: .bottom) {
            RemoteInboxScreen(
                projects: projects,
                isLoading: false,
                collapsedProjectIds: .constant([]),
                onToggleProject: { _ in },
                onSelectThread: { _ in },
                onComposeInProject: { _ in },
                onRefresh: {}
            )
            RemoteInboxBottomBar(
                searchText: .constant(""),
                searchFocused: $searchFocused,
                onCompose: {}
            )
            .padding(.horizontal, 16)
            .padding(.bottom, 10)
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                InboxTitleLockup(hostLabel: "MacBook-Pro-2.local", isConnected: true)
            }
        }
    }
}
