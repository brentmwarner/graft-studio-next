import Foundation

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
}

struct InboxThreadItem: Identifiable, Equatable, Hashable, Sendable {
    let id: String
    let title: String
    /// Blue attention dot (active run / needs attention).
    let showsAttentionDot: Bool
    /// Tracked PR badge, when the host knows its GitHub state.
    let pr: ThreadPrInfo?

    init(id: String, title: String, showsAttentionDot: Bool, pr: ThreadPrInfo? = nil) {
        self.id = id
        self.title = title
        self.showsAttentionDot = showsAttentionDot
        self.pr = pr
    }
}

enum InboxGrouping {
    private static let attentionStatuses: Set<String> = ["running", "needs_attention"]

    private static func attentionDot(
        for thread: ThreadInfo,
        activeThreadIds: Set<String>
    ) -> Bool {
        activeThreadIds.contains(thread.id)
            || thread.status.map(attentionStatuses.contains) == true
    }

    /// Default titles the host assigns before a thread earns a real name.
    private static let placeholderTitles: Set<String> = ["new thread", "untitled"]

    /// The drawer's Recents: what the user is in the middle of — threads
    /// waiting on a decision first, then live runs, then the freshest
    /// worked-on threads. Idle never-renamed placeholder threads stay out;
    /// they read as noise, not recent work.
    static func recentThreads(
        from snapshot: EnvironmentSnapshot?,
        limit: Int = 10
    ) -> [InboxThreadItem] {
        guard let snapshot else { return [] }
        let activeThreadIds = Set(snapshot.activeRuns.map(\.threadId))

        func rank(_ thread: ThreadInfo) -> Int {
            if thread.status == "needs_attention" { return 0 }
            if thread.status == "running" || activeThreadIds.contains(thread.id) { return 1 }
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
            .map {
                InboxThreadItem(
                    id: $0.id,
                    title: $0.title,
                    showsAttentionDot: attentionDot(for: $0, activeThreadIds: activeThreadIds),
                    pr: $0.pr
                )
            }
    }

    static func projects(
        from snapshot: EnvironmentSnapshot?,
        searchQuery: String
    ) -> [InboxProjectGroup] {
        guard let snapshot else { return [] }

        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        let activeThreadIds = Set(snapshot.activeRuns.map(\.threadId))

        func threadItems(from threads: [ThreadInfo]) -> [InboxThreadItem] {
            threads
                .map {
                    InboxThreadItem(
                        id: $0.id,
                        title: $0.title,
                        showsAttentionDot: attentionDot(for: $0, activeThreadIds: activeThreadIds),
                        pr: $0.pr
                    )
                }
                .sorted {
                    $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
                }
        }

        var groups: [InboxProjectGroup] = snapshot.projects.map { project in
            let threads = snapshot.threads.filter { $0.projectId == project.id }
            return InboxProjectGroup(
                id: project.id,
                name: project.name,
                threads: threadItems(from: threads)
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
            return InboxProjectGroup(id: group.id, name: group.name, threads: matching)
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
        calendar: Calendar = .current
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
                thread: InboxThreadItem(
                    id: thread.id, title: thread.title,
                    showsAttentionDot: rank(thread) < 2, pr: thread.pr
                ),
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
