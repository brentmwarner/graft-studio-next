import Foundation

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
