import SwiftUI

/// Remote inbox — project hierarchy matching the Graft Mobile product surface
/// (hierarchical remote projects list), not the Fetch chat home.
///
/// Compact horizontal size class keeps the phone drawer under a
/// `NavigationStack`. Regular width floats an inset Liquid Glass Projects
/// panel, always reserving chat space beside it while visible.
struct HomeView: View {
    @Environment(MachineStore.self) private var machines
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var selectedMachineId: String?
    @State private var showPairing = false
    @State private var chooseComposeMachine = false
    @State private var searchText = ""
    @State private var expandedProjectIds: Set<String> = []
    @State private var viewMode: InboxViewMode = .project
    @State private var showDrawer = false
    @State private var showSettings = false
    @State private var selectedThread: InboxThreadItem?
    @State private var newChatContext: NewChatContext?
    @FocusState private var searchFieldFocused: Bool

    private var usesPersistentSidebar: Bool {
        AdaptiveChrome.usesPersistentSidebar(horizontalSizeClass: horizontalSizeClass)
    }

    var body: some View {
        Group {
            if usesPersistentSidebar {
                FloatingSidebarLayout(
                    hostLabel: hostLabel,
                    isConnected: visibleMachines.contains { $0.gateway.state == .connected },
                    onSettings: { showSettings = true },
                    viewMode: $viewMode
                ) {
                    inboxContent
                } detail: {
                    HomeChatDetail(
                        selectedThread: selectedThread,
                        newChatContext: newChatContext,
                        onOpenThread: openThread,
                        onNewChat: { openNewChat() }
                    )
                }
            } else {
                compactHome
            }
        }
        .onAppear {
            viewMode = InboxViewPreferences.load(environmentId: selectedMachineId ?? "_all_computers")
            updateConversationCoverage()
        }
        .onChange(of: selectedMachineId) { _, id in
            viewMode = InboxViewPreferences.load(environmentId: id ?? "_all_computers")
        }
        .onChange(of: viewMode) { _, mode in
            InboxViewPreferences.save(mode, environmentId: selectedMachineId ?? "_all_computers")
        }
        .onChange(of: showSettings) { _, _ in updateConversationCoverage() }
        .onChange(of: showPairing) { _, _ in updateConversationCoverage() }
        .onChange(of: showDrawer) { _, _ in updateConversationCoverage() }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .sheet(isPresented: $showPairing) {
            PairingView(isPresented: $showPairing).environment(machines.pairingApp)
        }
        .confirmationDialog("Choose a computer", isPresented: $chooseComposeMachine) {
            ForEach(machines.machines) { machine in
                Button(machine.environmentLabel) {
                    newChatContext = NewChatContext(environmentId: machine.id)
                }
                .disabled(machine.gateway.state != .connected)
            }
        }
        .onChange(of: machines.machines.map(\.id)) { _, ids in
            updateConversationCoverage()
            if let selectedMachineId, !ids.contains(selectedMachineId) { self.selectedMachineId = nil }
            if let id = selectedThread?.environmentId, !ids.contains(id) { selectedThread = nil }
            if let id = newChatContext?.environmentId, !ids.contains(id) { newChatContext = nil }
        }
    }

    /// Phone / compact: drawer under a stack. Selecting a thread or compose
    /// destination still pushes, independent of the floating iPad panel.
    private var compactHome: some View {
        NavDrawerLayout(
            isOpen: $showDrawer,
            hostLabel: hostLabel,
            isConnected: visibleMachines.contains { $0.gateway.state == .connected },
            computers: machines.machines.map { machine in
                PairedComputerItem(
                    id: machine.id,
                    label: machine.environmentLabel,
                    isActive: selectedMachineId == machine.id,
                    isConnected: machine.gateway.state == .connected
                )
            },
            recentThreads: inbox.recents(),
            canSwipeOpen: selectedThread == nil && newChatContext == nil,
            onSearch: { focusInboxSearch() },
            onSelectThread: openThread,
            onSelectComputer: { id in
                selectedMachineId = id
                selectedThread = nil
                newChatContext = nil
            },
            onNewChat: { openNewChat() },
            onSettings: { showSettings = true }
        ) {
            NavigationStack {
                inboxRoot
                    .navigationDestination(item: $selectedThread) { thread in
                        if let machine = machines.machine(thread.environmentId) {
                            ThreadView(threadId: thread.threadId, title: thread.title)
                                .environment(machine)
                                .id("\(machine.sessionIdentity ?? "")/\(thread.id)")
                        }
                    }
                    .navigationDestination(item: $newChatContext) { context in
                        if let machine = machines.machine(context.environmentId) {
                            NewChatView(preselectedProjectId: context.preselectedProjectId)
                                .environment(machine)
                                .id("\(machine.sessionIdentity ?? "")/\(context.id)")
                        }
                    }
            }
        }
    }

    private var inboxContent: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    RemoteInboxScreen(
                        projects: inboxProjects,
                        recentThreads: usesPersistentSidebar ? inbox.recents() : [],
                        isLoading: false,
                        expandedProjectIds: $expandedProjectIds,
                        mode: viewMode,
                        sections: inbox.sections(mode: viewMode, search: searchText, now: context.date),
                        searchQuery: searchText,
                        selectedThreadId: usesPersistentSidebar ? selectedThread?.id : nil,
                        fillsOpaqueBackground: AdaptiveChrome.paintsOpaqueInboxBackground(
                            usesPersistentSidebar: usesPersistentSidebar
                        ),
                        onToggleProject: { id in
                            if expandedProjectIds.contains(id) {
                                expandedProjectIds.remove(id)
                            } else {
                                expandedProjectIds.insert(id)
                            }
                        },
                        onSelectThread: openThread,
                        onThreadAction: { thread, action in
                            guard let machine = machines.machine(thread.environmentId) else {
                                throw GraftError.decoding("Computer unavailable. Reconnect and try again.")
                            }
                            try await machine.manageThread(thread.threadId, action: action)
                        },
                        onComposeInProject: { openNewChat(projectId: $0) },
                        onComposeChats: { openNewChat() },
                        onRefresh: { visibleMachines.forEach { $0.reconnectIfNeeded() } }
                    )
                }
                .safeAreaBar(edge: .top, spacing: 0) {
                    MachineFilterBar(machines: machines.machines, selection: $selectedMachineId)
                }
            }

            RemoteInboxBottomBar(
                searchText: $searchText,
                searchFocused: $searchFieldFocused,
                onCompose: { openNewChat() }
            )
            .padding(.horizontal, 16)
            .padding(.bottom, 10)

            if let machine = visibleMachines.first(where: { $0.connectionWarning != nil }), let error = machine.connectionWarning {
                VStack {
                    Spacer()
                    HomeGatewayErrorBanner(message: "\(machine.environmentLabel): \(homeErrorMessage(error))")
                        .padding(.bottom, 72)
                }
            }
        }
    }

    private var inboxRoot: some View {
        inboxContent
            .navigationTitle(Text("Projects", comment: "Remote inbox navigation title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { inboxToolbar }
    }

    @ToolbarContentBuilder
    private var inboxToolbar: some ToolbarContent {
        if !usesPersistentSidebar {
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
        }
        ToolbarItem(placement: .principal) {
            InboxTitleLockup(
                hostLabel: hostLabel,
                isConnected: visibleMachines.contains { $0.gateway.state == .connected }
            )
        }
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                InboxViewOptions(selection: $viewMode)
                Button("Add computer", systemImage: "plus") { showPairing = true }
                Divider()
                Button("Settings", systemImage: "gearshape") { showSettings = true }
            } label: {
                Image(systemName: "ellipsis")
            }
            .accessibilityLabel("Projects options")
        }
    }

    private func updateConversationCoverage() {
        machines.machines.forEach { $0.setConversationCovered(showSettings || showPairing || showDrawer) }
    }

    private var visibleMachines: [AppModel] {
        machines.machines.filter { selectedMachineId == nil || $0.id == selectedMachineId }
    }
    private var inbox: MachineInbox { MachineInbox(machines: visibleMachines) }
    private var inboxProjects: [InboxProjectGroup] { inbox.projects(search: searchText) }

    private func openThread(_ thread: InboxThreadItem) {
        newChatContext = nil
        selectedThread = thread
    }

    private func openNewChat(projectId: String? = nil) {
        selectedThread = nil
        if let projectId, let resource = MachineResourceID.decode(projectId) {
            newChatContext = NewChatContext(preselectedProjectId: resource.resourceId, environmentId: resource.environmentId)
        } else if visibleMachines.count == 1, let machine = visibleMachines.first {
            newChatContext = NewChatContext(environmentId: machine.id)
        } else {
            chooseComposeMachine = true
        }
    }

    private func focusInboxSearch() {
        Task {
            try? await Task.sleep(for: .seconds(0.35))
            searchFieldFocused = true
        }
    }

    private var hostLabel: String {
        if let selectedMachineId, let machine = machines.machine(selectedMachineId) {
            return machine.environmentLabel
        }
        return "All computers"
    }
}

/// Keeps the active chat at one structural location when the panel is toggled
/// or resized, preserving its composer and session lifecycle.
private struct HomeChatDetail: View {
    @Environment(MachineStore.self) private var machines
    let selectedThread: InboxThreadItem?
    let newChatContext: NewChatContext?
    let onOpenThread: (InboxThreadItem) -> Void
    let onNewChat: () -> Void

    var body: some View {
        if let thread = selectedThread, let machine = machines.machine(thread.environmentId) {
            ThreadView(threadId: thread.threadId, title: thread.title)
                .environment(machine)
                .id("\(machine.sessionIdentity ?? "")/\(thread.id)")
        } else if let context = newChatContext, let machine = machines.machine(context.environmentId) {
            NewChatView(
                preselectedProjectId: context.preselectedProjectId,
                onOpenedThread: { thread in
                    var thread = thread
                    thread.environmentId = context.environmentId
                    onOpenThread(thread)
                }
            )
            .environment(machine)
            .id("\(machine.sessionIdentity ?? "")/\(context.id)")
        } else {
            HomeEmptyChatPlaceholder(onNewChat: onNewChat)
        }
    }
}

/// Empty regular-width detail: pick a sidebar thread or start one.
struct HomeEmptyChatPlaceholder: View {
    let onNewChat: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(
                "Select a chat",
                systemImage: "bubble.left.and.bubble.right"
            )
        } description: {
            Text(
                "Choose a thread from the sidebar or start a new chat.",
                comment: "Regular-width empty chat detail guidance"
            )
        } actions: {
            Button(action: onNewChat) {
                Label("New chat", systemImage: "square.and.pencil")
            }
            .buttonStyle(.borderedProminent)
        }
        .readableChatColumn()
        .navigationTitle(Text("Chat", comment: "Empty regular-width chat title"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                ChatNavigationTitle {
                    Text("Chat", comment: "Empty regular-width chat title")
                        .font(.headline)
                        .lineLimit(1)
                        .accessibilityAddTraits(.isHeader)
                }
            }
        }
    }
}

/// Pushes the new-chat screen; carries the optional project the compose came
/// from (project pencil rows preselect, the bottom-bar pencil doesn't).
struct NewChatContext: Identifiable, Hashable {
    let id = UUID()
    var preselectedProjectId: String?
    var environmentId: String?
}

/// Projects title; connection states live in the computer filter row.
struct InboxTitleLockup: View {
    let hostLabel: String
    let isConnected: Bool
    var alignment: HorizontalAlignment = .center

    var body: some View {
        VStack(alignment: alignment, spacing: 2) {
            Text("Projects", comment: "Remote inbox navigation title")
                .font(.headline.weight(.semibold))
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Screen

struct RemoteInboxScreen: View {
    let projects: [InboxProjectGroup]
    var recentThreads: [InboxThreadItem] = []
    let isLoading: Bool
    @Binding var expandedProjectIds: Set<String>
    var mode: InboxViewMode = .project
    var sections: [InboxThreadSection] = []
    var searchQuery: String = ""
    @State private var collapsedSections: Set<String> = []
    @State private var collapsedSearchProjects: Set<String> = []
    @State private var collapsedSearchSections: Set<String> = []
    var selectedThreadId: String? = nil
    /// Phone inbox paints `systemBackground` over the drawer. The iPad
    /// floating panel stays clear so its glass background can show through.
    var fillsOpaqueBackground: Bool = true
    let onToggleProject: (String) -> Void
    let onSelectThread: (InboxThreadItem) -> Void
    var onThreadAction: ((InboxThreadItem, InboxThreadAction) async throws -> Void)? = nil
    let onComposeInProject: (String) -> Void
    var onComposeChats: (() -> Void)? = nil
    let onRefresh: () -> Void

    var body: some View {
        Group {
            if isLoading {
                HomeConnectingPlaceholder()
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if projects.isEmpty || (mode != .project && sections.isEmpty) {
                            ContentUnavailableView(
                                isSearching ? "No matching chats" : mode == .project ? "No projects yet" : "No chats yet",
                                systemImage: isSearching ? "magnifyingglass" : "folder",
                                description: Text(isSearching ? "Try another name or project." : "Open a project or start a chat in Graft Studio to see it here.")
                            )
                            .padding(.top, 48)
                        } else if mode == .project {
                            if !isSearching && !recentThreads.isEmpty {
                                Text("Recents").font(.headline).padding(.horizontal, 20).padding(.vertical, 16)
                                ForEach(recentThreads) { thread in
                                    RemoteThreadRow(title: thread.title, activity: thread.activity,
                                        isSelected: selectedThreadId == thread.id, leadingInset: 20,
                                        onThreadAction: onThreadAction.map { handler in { action in try await handler(thread, action) } },
                                        action: { onSelectThread(thread) })
                                }
                            }
                            HStack {
                                Text("Chats").font(.headline)
                                Spacer()
                                if let project = projects.first(where: { $0.kind == "desktop" }) {
                                    Button {
                                        if let onComposeChats { onComposeChats() }
                                        else { onComposeInProject(project.id) }
                                    } label: {
                                        Image(systemName: "square.and.pencil").frame(width: 44, height: 44)
                                    }
                                    .accessibilityLabel("New chat in Chats")
                                    .tint(.primary)
                                }
                            }
                            .padding(.horizontal, 20)
                            .frame(minHeight: 52)
                            let chats = projects.filter { $0.kind == "desktop" }.flatMap(\.threads)
                            ForEach(chats) { thread in
                                RemoteThreadRow(title: thread.title, activity: thread.activity,
                                    isSelected: selectedThreadId == thread.id, leadingInset: 20,
                                    onThreadAction: onThreadAction.map { handler in { action in try await handler(thread, action) } },
                                    action: { onSelectThread(thread) })
                            }
                            if chats.isEmpty {
                                Text(isSearching ? "No matching chats" : "Chats started in Studio appear here.")
                                    .font(.subheadline).foregroundStyle(.secondary)
                                    .padding(.horizontal, 20).padding(.bottom, 16)
                            }
                            Text("Projects").font(.headline).padding(.horizontal, 20).padding(.vertical, 16)
                            ForEach(projects.filter { $0.kind != "desktop" }) { project in
                                RemoteProjectSection(
                                    name: project.name,
                                    threads: project.threads,
                                    isExpanded: isSearching ? !collapsedSearchProjects.contains(project.id) : expandedProjectIds.contains(project.id),
                                    selectedThreadId: selectedThreadId,
                                    onToggle: {
                                        if isSearching { toggle(project.id, in: &collapsedSearchProjects) }
                                        else { onToggleProject(project.id) }
                                    },
                                    onCompose: { onComposeInProject(project.id) },
                                    onSelectThread: onSelectThread,
                                    onThreadAction: onThreadAction
                                )
                            }
                        } else {
                            ForEach(sections) { section in
                                let key = "\(mode.rawValue)/\(section.id)"
                                let expanded = !(isSearching ? collapsedSearchSections : collapsedSections).contains(key)
                                VStack(alignment: .leading, spacing: 0) {
                                    Button {
                                        if isSearching { toggle(key, in: &collapsedSearchSections) }
                                        else { toggle(key, in: &collapsedSections) }
                                    } label: {
                                        HStack(spacing: 8) {
                                            Text(section.title).font(.headline)
                                            Image(systemName: "chevron.down")
                                                .font(.caption.weight(.semibold))
                                                .foregroundStyle(.secondary)
                                                .rotationEffect(.degrees(expanded ? 0 : -90))
                                            Spacer()
                                        }
                                        .foregroundStyle(.primary)
                                        .padding(.horizontal, 20)
                                        .frame(minHeight: 52)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityValue(expanded ? "Expanded" : "Collapsed")
                                    if expanded {
                                        ForEach(section.threads) { entry in
                                            RemoteThreadRow(
                                                title: entry.thread.title,
                                                activity: entry.thread.activity,
                                                isSelected: selectedThreadId == entry.id,
                                                projectName: mode == .priority ? entry.projectName : nil,
                                                leadingInset: 20,
                                                onThreadAction: onThreadAction.map { handler in { action in try await handler(entry.thread, action) } },
                                                action: { onSelectThread(entry.thread) }
                                            )
                                        }
                                    }
                                }
                                .padding(.bottom, 16)
                            }
                        }
                    }
                    .padding(.top, 8)
                    .padding(.bottom, 120)
                }
                .id(mode)
                .refreshable { onRefresh() }
            }
        }
        .background {
            if fillsOpaqueBackground {
                Color(.systemBackground)
            }
        }
        .scrollContentBackground(.hidden)
        .onChange(of: searchQuery) {
            collapsedSearchProjects.removeAll()
            collapsedSearchSections.removeAll()
        }
    }

    private var isSearching: Bool {
        !searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func toggle(_ id: String, in ids: inout Set<String>) {
        if ids.contains(id) { ids.remove(id) } else { ids.insert(id) }
    }
}

struct InboxViewOptions: View {
    @Binding var selection: InboxViewMode

    var body: some View {
        Picker("View", selection: $selection) {
            ForEach(InboxViewMode.allCases) { mode in
                Label(mode.title, systemImage: mode.symbol).tag(mode)
            }
        }
        .pickerStyle(.inline)
    }
}

// MARK: - Project section

struct RemoteProjectSection: View {
    let name: String
    let threads: [InboxThreadItem]
    let isExpanded: Bool
    var selectedThreadId: String? = nil
    let onToggle: () -> Void
    let onCompose: () -> Void
    let onSelectThread: (InboxThreadItem) -> Void
    var onThreadAction: ((InboxThreadItem, InboxThreadAction) async throws -> Void)? = nil

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
                        activity: thread.activity,
                        isSelected: selectedThreadId == thread.id,
                        onThreadAction: onThreadAction.map { handler in { action in try await handler(thread, action) } },
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
            .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
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
    var activity: InboxThreadActivity = .idle
    var isSelected: Bool = false
    var projectName: String? = nil
    var leadingInset: CGFloat = 52
    var onThreadAction: ((InboxThreadAction) async throws -> Void)? = nil
    let action: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var swipeOpen = false
    @State private var renaming = false
    @State private var deleting = false
    @State private var draftTitle = ""
    @State private var busy = false
    @State private var actionError: String?

    var body: some View {
        ZStack(alignment: .trailing) {
            if swipeOpen {
                HStack(spacing: 0) {
                    Button("Rename", systemImage: "pencil", action: beginRename)
                        .frame(width: 80)
                    Button("Archive", systemImage: "archivebox") { perform(.archive) }
                        .frame(width: 80)
                    Button("Delete", systemImage: "trash", role: .destructive) { deleting = true }
                        .frame(width: 80)
                }
                .labelStyle(.iconOnly)
                .frame(maxHeight: .infinity)
                .background(.secondary.opacity(0.12))
                .disabled(busy)
            }
            row
                .background {
                    if swipeOpen { Color(.systemBackground) }
                }
                .offset(x: swipeOpen ? -240 : 0)
                .simultaneousGesture(
                    DragGesture(minimumDistance: 24)
                        .onEnded { value in
                            guard onThreadAction != nil, !busy,
                                  abs(value.translation.width) > abs(value.translation.height) * 2 else { return }
                            withAnimation(reduceMotion ? nil : .snappy) {
                                swipeOpen = value.translation.width < -40
                            }
                        }
                )
                .contextMenu {
                    if onThreadAction != nil {
                        Button("Rename", systemImage: "pencil", action: beginRename)
                        Button("Archive", systemImage: "archivebox") { perform(.archive) }
                        Button("Delete", systemImage: "trash", role: .destructive) { deleting = true }
                    }
                }
        }
        .clipped()
        .disabled(busy)
        .alert("Rename chat", isPresented: $renaming) {
            TextField("Chat title", text: $draftTitle)
            Button("Cancel", role: .cancel) {}
            Button("Save") { perform(.rename(draftTitle.trimmingCharacters(in: .whitespacesAndNewlines))) }
                .disabled(draftTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draftTitle.count > 200)
        }
        .confirmationDialog("Delete chat?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { perform(.delete) }
        } message: {
            Text("“\(title)” will be permanently deleted.")
        }
        .alert("Could not update chat", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK", role: .cancel) { actionError = nil }
        } message: {
            Text(actionError ?? "")
        }
        .accessibilityAction(named: "Rename") { if onThreadAction != nil { beginRename() } }
        .accessibilityAction(named: "Archive") { perform(.archive) }
        .accessibilityAction(named: "Delete") { if onThreadAction != nil { deleting = true } }
    }

    private func beginRename() {
        draftTitle = title
        swipeOpen = false
        renaming = true
    }

    private func perform(_ action: InboxThreadAction) {
        guard let onThreadAction, !busy else { return }
        busy = true
        Task { @MainActor in
            defer { busy = false }
            do {
                try await onThreadAction(action)
                swipeOpen = false
            } catch {
                actionError = error.localizedDescription
            }
        }
    }

    private var row: some View {
        Button {
            if swipeOpen { swipeOpen = false } else { action() }
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(title)
                        .font(.body)
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    if let projectName {
                        Label(projectName, systemImage: "folder")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 8)

                InboxThreadActivityIndicator(activity: activity)
            }
            .padding(.leading, leadingInset)
            .padding(.trailing, 20)
            .padding(.vertical, 11)
            .background {
                if isSelected {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.primary.opacity(0.08))
                        .padding(.horizontal, 10)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
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
                InboxThreadItem(id: "t1", title: "Audit Graft identity coverage", activity: .working),
                InboxThreadItem(id: "t2", title: "Audit capability coverage for Graft", activity: .idle),
                InboxThreadItem(id: "t9", title: "Plan Graft Mobile remote access", activity: .idle),
            ]
        ),
        InboxProjectGroup(
            id: "2",
            name: "graft",
            threads: [
                InboxThreadItem(id: "t4", title: "Polish remote inbox hierarchy", activity: .idle),
                InboxThreadItem(id: "t5", title: "Wire approval prompts on mobile", activity: .idle),
            ]
        ),
    ]

    NavigationStack {
        ZStack(alignment: .bottom) {
            RemoteInboxScreen(
                projects: projects,
                isLoading: false,
                expandedProjectIds: .constant([]),
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

struct InboxThreadActivityIndicator: View {
    let activity: InboxThreadActivity
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        switch activity {
        case .working:
            Group {
                if reduceMotion { Image(systemName: "hourglass") }
                else { ProgressView().controlSize(.small).tint(.secondary) }
            }
            .frame(width: 18, height: 18)
            .accessibilityLabel("Working")
        case .unread:
            Circle().fill(Color.blue).frame(width: 8, height: 8)
                .accessibilityLabel("Unread response")
        case .needsAttention:
            Image(systemName: "exclamationmark.circle")
                .foregroundStyle(.secondary)
                .accessibilityLabel("Needs attention")
        case .idle:
            EmptyView()
        }
    }
}


struct MachineFilterBar: View {
    let machines: [AppModel]
    @Binding var selection: String?

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 7) {
                Button { selection = nil } label: {
                    Text("All").padding(.horizontal, 12).padding(.vertical, 7)
                        .frame(minWidth: 42, minHeight: 32)
                        .foregroundStyle(selection == nil ? Color(uiColor: .systemBackground) : .primary)
                        .background(selection == nil ? Color.primary : Color(uiColor: .secondarySystemBackground), in: .capsule)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(.rect)
                }
                .accessibilityAddTraits(selection == nil ? .isSelected : [])
                ForEach(machines) { machine in
                    Button { selection = machine.id } label: {
                        HStack(spacing: 8) {
                            Circle().fill(machine.gateway.state == .connected
                                ? Color(red: 29 / 255, green: 191 / 255, blue: 137 / 255)
                                : Color(red: 1, green: 55 / 255, blue: 95 / 255))
                                .frame(width: 7, height: 7)
                            HStack(spacing: 4) {
                                Image(systemName: "laptopcomputer")
                                    .font(.system(size: 16))
                                Text(verbatim: machine.environmentLabel).lineLimit(1)
                            }
                        }
                        .padding(.horizontal, 10).padding(.vertical, 7)
                        .frame(minHeight: 32)
                        .foregroundStyle(selection == machine.id ? Color(uiColor: .systemBackground) : .primary)
                        .background(selection == machine.id ? Color.primary : Color(uiColor: .secondarySystemBackground), in: .capsule)
                        .frame(minHeight: 44)
                        .contentShape(.rect)
                    }
                    .accessibilityLabel("\(machine.environmentLabel), \(machine.gateway.state == .connected ? "Connected" : "Offline")")
                    .accessibilityAddTraits(selection == machine.id ? .isSelected : [])
                }
            }
            .font(.caption)
            .buttonStyle(.plain)
            .padding(.horizontal, 18).padding(.vertical, 4)
        }
        .scrollIndicators(.hidden)
    }
}
