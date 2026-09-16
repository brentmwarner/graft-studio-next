import Foundation

enum TaskProgressStatus: String, Codable, Sendable {
    case pending, active, done
}

struct TaskProgressItem: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let title: String
    let status: TaskProgressStatus
}

/// Unknown rich-event payloads must never prevent the surrounding event from decoding.
struct TimelineTaskData: Codable, Sendable, Equatable {
    struct Todo: Codable, Sendable, Equatable {
        enum Status: String, Codable, Sendable { case pending, in_progress, completed }
        let id: String
        let text: String
        let status: Status
    }

    let type: String
    var title: String? = nil
    var steps: [TaskProgressItem]? = nil
    var todos: [Todo]? = nil

    var items: [TaskProgressItem]? {
        let values: [TaskProgressItem]?
        switch type {
        case "plan": values = steps
        case "todo_update":
            values = todos?.map { todo in
                let status: TaskProgressStatus
                switch todo.status {
                case .pending: status = .pending
                case .in_progress: status = .active
                case .completed: status = .done
                }
                return TaskProgressItem(id: todo.id, title: todo.text, status: status)
            }
        default: values = nil
        }
        guard let values else { return nil }
        var ids: Set<String> = []
        let readable = values.prefix(100).filter {
            !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && ids.insert($0.id).inserted
        }
        return !values.isEmpty && readable.isEmpty ? nil : readable
    }
}

extension TimelineTaskData {
    init(from decoder: Decoder) throws {
        let container = try? decoder.container(keyedBy: CodingKeys.self)
        type = (try? container?.decode(String.self, forKey: .type)) ?? ""
        title = try? container?.decode(String.self, forKey: .title)
        steps = try? container?.decode([TaskProgressItem].self, forKey: .steps)
        todos = try? container?.decode([Todo].self, forKey: .todos)
    }
}

struct TaskProgress: Sendable, Equatable, Identifiable {
    let id: String
    let title: String
    let items: [TaskProgressItem]

    var completedCount: Int { items.filter { $0.status == .done }.count }
    var isComplete: Bool { items.allSatisfy { $0.status == .done } }
}

/// Task snapshots are independent of message arrival and streaming status.
/// Like desktop, unfinished work carries across turns until replaced or cleared.
struct TaskProgressState: Sendable, Equatable {
    private var latest: TaskProgress?
    private var current: TaskProgress?
    private var turnID: String?
    private var userIDs: Set<String> = []

    var visible: TaskProgress? {
        guard let list = current ?? latest, !list.items.isEmpty else { return nil }
        return current != nil || turnID == nil || !list.isComplete ? list : nil
    }

    mutating func beginTurn(id: String) {
        guard turnID != id else { return }
        turnID = id
        current = nil
    }

    mutating func fold(_ event: TimelineEvent) {
        if event.kind == "user.message" {
            if userIDs.insert(event.id).inserted { beginTurn(id: event.runId ?? event.id) }
            return
        }
        guard ["plan.update", "todo.update"].contains(event.kind),
              let items = event.data?.items else { return }
        let id = event.runId ?? turnID ?? event.id
        if turnID == nil { turnID = id }
        guard current == nil || id == turnID else { return }
        let title = event.data?.title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let list = TaskProgress(id: id, title: (title?.isEmpty == false ? title : nil) ?? "Tasks", items: items)
        latest = list
        if id == turnID { current = list }
    }

    static func replay(_ events: [TimelineEvent]) -> Self {
        var state = Self()
        for event in events { state.fold(event) }
        return state
    }
}
