import Foundation

enum InboxViewPreferences {
    private static let legacyKey = "inbox.viewMode"

    static func key(environmentId: String?) -> String {
        guard let environmentId, !environmentId.isEmpty else { return legacyKey }
        return "\(legacyKey).\(environmentId)"
    }

    static func load(environmentId: String?, defaults: UserDefaults = .standard) -> InboxViewMode {
        let scoped = defaults.string(forKey: key(environmentId: environmentId))
        if let scoped, let mode = InboxViewMode(rawValue: scoped) { return mode }
        if let legacy = defaults.string(forKey: legacyKey),
           let mode = InboxViewMode(rawValue: legacy) {
            if let environmentId, !environmentId.isEmpty {
                defaults.set(legacy, forKey: key(environmentId: environmentId))
            }
            return mode
        }
        return .project
    }

    static func save(_ mode: InboxViewMode, environmentId: String?, defaults: UserDefaults = .standard) {
        defaults.set(mode.rawValue, forKey: key(environmentId: environmentId))
    }
}

enum InboxReadVisibility {
    static func visibleThreadId(
        isForeground: Bool,
        isConversationCovered: Bool,
        selectedThreadId: String?,
        loadedTranscriptThreadId: String?
    ) -> String? {
        guard isForeground,
              !isConversationCovered,
              let selectedThreadId,
              selectedThreadId == loadedTranscriptThreadId
        else { return nil }
        return selectedThreadId
    }
}

enum InboxViewMode: String, CaseIterable, Identifiable {
    case priority
    case project
    case chronological

    var id: String { rawValue }
    var title: String {
        switch self {
        case .priority: "Priority"
        case .project: "By Project"
        case .chronological: "Chronological"
        }
    }
    var symbol: String {
        switch self {
        case .priority: "bell"
        case .project: "folder"
        case .chronological: "clock.arrow.circlepath"
        }
    }
}

struct InboxThreadSection: Identifiable, Equatable {
    let id: String
    let title: String
    let threads: [InboxThreadEntry]
}

struct InboxThreadEntry: Identifiable, Equatable {
    let thread: InboxThreadItem
    let projectName: String?
    var id: String { thread.id }
}

/// Project → threads hierarchy for the Remote inbox.
struct InboxProjectGroup: Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    var threads: [InboxThreadItem]
    var kind: String = "repo"
}

enum InboxThreadActivity: String, Equatable, Hashable, Sendable {
    case idle, working, unread, needsAttention
}

struct InboxThreadItem: Identifiable, Equatable, Hashable, Sendable {
    let threadId: String
    var environmentId: String?
    var id: String { environmentId.map { MachineResourceID.encode($0, threadId) } ?? threadId }
    let title: String
    let updatedAt: Int
    let activity: InboxThreadActivity
    let pr: ThreadPrInfo?

    init(id: String, title: String, activity: InboxThreadActivity = .idle, pr: ThreadPrInfo? = nil, environmentId: String? = nil, updatedAt: Int = 0) {
        self.threadId = id
        self.environmentId = environmentId
        self.updatedAt = updatedAt
        self.title = title
        self.activity = activity
        self.pr = pr
    }
}

struct InboxReadReceipt: Codable, Equatable {
    var completedAt: Int = 0
    var viewedAt: Int = 0
}

struct InboxReadState: Codable, Equatable {
    var receipts: [String: InboxReadReceipt] = [:]

    var unreadThreadIds: Set<String> {
        Set(receipts.compactMap { $0.value.completedAt > $0.value.viewedAt ? $0.key : nil })
    }

    mutating func completed(_ threadId: String, at timestamp: Int) {
        guard timestamp > (receipts[threadId]?.completedAt ?? 0) else { return }
        receipts[threadId, default: InboxReadReceipt()].completedAt = timestamp
    }

    mutating func viewed(_ threadId: String) {
        guard var receipt = receipts[threadId], receipt.completedAt > receipt.viewedAt else { return }
        receipt.viewedAt = receipt.completedAt
        receipts[threadId] = receipt
    }
}

enum InboxGrouping {
    static func item(_ thread: ThreadInfo, snapshot: EnvironmentSnapshot, unreadThreadIds: Set<String> = [], isConnected: Bool = true) -> InboxThreadItem {
        let activity: InboxThreadActivity
        if !isConnected {
            activity = unreadThreadIds.contains(thread.id) ? .unread : .idle
        } else if thread.status == "needs_attention" || snapshot.pendingApprovals.contains(where: { $0.threadId == thread.id }) || snapshot.pendingQuestions.contains(where: { $0.threadId == thread.id }) {
            activity = .needsAttention
        } else if thread.status == "running" || snapshot.activeRuns.contains(where: { $0.threadId == thread.id && ($0.status == "running" || $0.status == "queued") }) {
            activity = .working
        } else if unreadThreadIds.contains(thread.id) {
            activity = .unread
        } else {
            activity = .idle
        }
        return InboxThreadItem(id: thread.id, title: thread.title, activity: activity, pr: thread.pr, updatedAt: thread.updatedAt)
    }

    /// Default titles the host assigns before a thread earns a real name.
    private static let placeholderTitles: Set<String> = ["new thread", "untitled"]

    /// The drawer's Recents: what the user is in the middle of — threads
    /// waiting on a decision first, then live runs, then the freshest
    /// worked-on threads. Idle never-renamed placeholder threads stay out;
    /// they read as noise, not recent work.
    static func recentThreads(
        from snapshot: EnvironmentSnapshot?,
        limit: Int = 10,
        unreadThreadIds: Set<String> = [],
        isConnected: Bool = true
    ) -> [InboxThreadItem] {
        guard let snapshot else { return [] }
        func rank(_ thread: ThreadInfo) -> Int {
            let activity = item(thread, snapshot: snapshot, unreadThreadIds: unreadThreadIds, isConnected: isConnected).activity
            if activity == .needsAttention { return 0 }
            if activity == .working { return 1 }
            return 2
        }

        return snapshot.threads
            .filter { thread in
                rank(thread) < 2
                    || !placeholderTitles.contains(thread.title.lowercased())
            }
            .sorted { lhs, rhs in
                let lhsRank = rank(lhs)
                let rhsRank = rank(rhs)
                if lhsRank != rhsRank { return lhsRank < rhsRank }
                return lhs.updatedAt > rhs.updatedAt
            }
            .prefix(limit)
            .map { item($0, snapshot: snapshot, unreadThreadIds: unreadThreadIds, isConnected: isConnected) }
    }

    static func projects(
        from snapshot: EnvironmentSnapshot?,
        searchQuery: String,
        unreadThreadIds: Set<String> = [],
        isConnected: Bool = true
    ) -> [InboxProjectGroup] {
        guard let snapshot else { return [] }

        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        func threadItems(from threads: [ThreadInfo]) -> [InboxThreadItem] {
            threads
                .map { item($0, snapshot: snapshot, unreadThreadIds: unreadThreadIds, isConnected: isConnected) }
                .sorted {
                    $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
                }
        }

        var groups: [InboxProjectGroup] = snapshot.projects.map { project in
            let threads = snapshot.threads.filter { $0.projectId == project.id }
            return InboxProjectGroup(
                id: project.id,
                name: project.name,
                threads: threadItems(from: threads),
                kind: project.kind
            )
        }

        let knownProjectIds = Set(groups.map(\.id))
        let orphans = snapshot.threads.filter { !knownProjectIds.contains($0.projectId) }
        if !orphans.isEmpty {
            groups.append(
                InboxProjectGroup(
                    id: "_orphans",
                    name: "Other",
                    threads: threadItems(from: orphans)
                )
            )
        }

        guard !query.isEmpty else { return groups }

        let lowered = query.lowercased()
        return groups.compactMap { group in
            if group.name.lowercased().contains(lowered) {
                return group
            }
            let matching = group.threads.filter { $0.title.lowercased().contains(lowered) }
            guard !matching.isEmpty else { return nil }
            return InboxProjectGroup(id: group.id, name: group.name, threads: matching, kind: group.kind)
        }
    }
}


extension InboxGrouping {
    /// Both list modes use host timestamps (milliseconds) and the user's local calendar.
    /// Priority takes decision requests and active work out of the date sections once.
    static func sections(
        from snapshot: EnvironmentSnapshot?,
        mode: InboxViewMode,
        searchQuery: String,
        now: Date = .now,
        calendar: Calendar = .current,
        unreadThreadIds: Set<String> = [],
        isConnected: Bool = true
    ) -> [InboxThreadSection] {
        guard let snapshot, mode != .project else { return [] }
        let projects = Dictionary(snapshot.projects.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        let matchingIds = Set(self.projects(from: snapshot, searchQuery: searchQuery).flatMap { $0.threads.map(\.id) })
        let decisions = Set(snapshot.pendingApprovals.map(\.threadId) + snapshot.pendingQuestions.map(\.threadId))
        let active = Set(snapshot.activeRuns.map(\.threadId))
        let today = calendar.startOfDay(for: now)
        let yesterday = calendar.date(byAdding: .day, value: -1, to: today)!
        let week = calendar.date(byAdding: .day, value: -7, to: today)!

        func rank(_ thread: ThreadInfo) -> Int {
            guard isConnected else { return 2 }
            if decisions.contains(thread.id) || thread.status == "needs_attention" { return 0 }
            if active.contains(thread.id) || thread.status == "running" { return 1 }
            return 2
        }

        let threads = snapshot.threads.filter { matchingIds.contains($0.id) }.sorted {
            if mode == .priority, rank($0) != rank($1) { return rank($0) < rank($1) }
            if $0.updatedAt != $1.updatedAt { return $0.updatedAt > $1.updatedAt }
            return $0.id < $1.id
        }
        var buckets: [String: [InboxThreadEntry]] = [:]
        for thread in threads {
            let date = Date(timeIntervalSince1970: Double(thread.updatedAt) / 1000)
            let key: String
            if mode == .priority && rank(thread) < 2 { key = "priority" }
            else if date >= today { key = "today" }
            else if date >= yesterday { key = "yesterday" }
            else if date >= week { key = "week" }
            else { key = "older" }
            buckets[key, default: []].append(InboxThreadEntry(
                thread: item(thread, snapshot: snapshot, unreadThreadIds: unreadThreadIds, isConnected: isConnected),
                projectName: projects[thread.projectId]
            ))
        }
        return [("priority", "Priority"), ("today", "Today"), ("yesterday", "Yesterday"),
                ("week", "Previous 7 days"), ("older", "Older")].compactMap { id, title in
            guard let items = buckets[id], !items.isEmpty else { return nil }
            return InboxThreadSection(id: id, title: title, threads: items)
        }
    }
}


/// Length-safe namespacing for UI identity and cache keys. Wire IDs remain unchanged.
enum MachineResourceID {
    static func encode(_ environmentId: String, _ resourceId: String) -> String {
        String(data: try! JSONEncoder().encode([environmentId, resourceId]), encoding: .utf8)!
    }
    static func decode(_ value: String) -> (environmentId: String, resourceId: String)? {
        guard let parts = try? JSONDecoder().decode([String].self, from: Data(value.utf8)), parts.count == 2 else { return nil }
        return (parts[0], parts[1])
    }
}

@MainActor
struct MachineInbox {
    let machines: [AppModel]

    private func activityRank(_ item: InboxThreadItem) -> Int {
        switch item.activity {
        case .needsAttention: 0
        case .working: 1
        case .idle, .unread: 2
        }
    }

    private func priorityOrder(_ lhs: InboxThreadItem, _ rhs: InboxThreadItem) -> Bool {
        let leftRank = activityRank(lhs)
        let rightRank = activityRank(rhs)
        if leftRank != rightRank { return leftRank < rightRank }
        if lhs.updatedAt != rhs.updatedAt { return lhs.updatedAt > rhs.updatedAt }
        return lhs.id < rhs.id
    }

    private func scoped(_ thread: InboxThreadItem, to machine: AppModel) -> InboxThreadItem {
        var thread = thread
        thread.environmentId = machine.environmentId
        return thread
    }

    func projects(search: String) -> [InboxProjectGroup] {
        machines.flatMap { machine in
            InboxGrouping.projects(from: machine.snapshot, searchQuery: search,
                unreadThreadIds: machine.inboxReadState.unreadThreadIds,
                isConnected: machine.gateway.state == .connected).map { project in
                InboxProjectGroup(
                    id: MachineResourceID.encode(machine.id, project.id),
                    name: machines.count > 1 ? "\(project.name) · \(machine.environmentLabel)" : project.name,
                    threads: project.threads.map { scoped($0, to: machine) }, kind: project.kind
                )
            }
        }
    }

    func recents() -> [InboxThreadItem] {
        Array(machines.flatMap { machine in
            InboxGrouping.recentThreads(from: machine.snapshot,
                unreadThreadIds: machine.inboxReadState.unreadThreadIds,
                isConnected: machine.gateway.state == .connected).map { scoped($0, to: machine) }
        }.sorted(by: priorityOrder).prefix(10))
    }

    func sections(mode: InboxViewMode, search: String, now: Date) -> [InboxThreadSection] {
        var sections: [String: InboxThreadSection] = [:]
        for machine in machines {
            for section in InboxGrouping.sections(from: machine.snapshot, mode: mode, searchQuery: search,
                now: now, unreadThreadIds: machine.inboxReadState.unreadThreadIds,
                isConnected: machine.gateway.state == .connected) {
                let entries = section.threads.map { entry in
                    InboxThreadEntry(thread: scoped(entry.thread, to: machine),
                        projectName: machines.count > 1 ? [entry.projectName, machine.environmentLabel].compactMap { $0 }.joined(separator: " · ") : entry.projectName)
                }
                sections[section.id] = InboxThreadSection(id: section.id, title: section.title,
                    threads: (sections[section.id]?.threads ?? []) + entries)
            }
        }
        return ["priority", "today", "yesterday", "week", "older"].compactMap { id in
            guard let section = sections[id] else { return nil }
            return InboxThreadSection(id: id, title: section.title,
                threads: section.threads.sorted {
                    if id == "priority" { return priorityOrder($0.thread, $1.thread) }
                    if $0.thread.updatedAt != $1.thread.updatedAt { return $0.thread.updatedAt > $1.thread.updatedAt }
                    return $0.id < $1.id
                })
        }
    }
}
