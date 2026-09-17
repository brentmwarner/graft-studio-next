import type { GraftTimelineEvent } from "@graft/mobile-contract";

export interface TaskProgressItem {
  readonly id: string;
  readonly title: string;
  readonly status: "pending" | "active" | "done";
}

export interface TaskProgress {
  readonly id: string;
  readonly title: string;
  readonly items: readonly TaskProgressItem[];
  readonly completedCount: number;
  readonly isComplete: boolean;
}

export function deriveTaskProgress(
  events: readonly GraftTimelineEvent[],
): TaskProgress | undefined {
  let turnId: string | undefined;
  let current: TaskProgress | undefined;
  let latest: TaskProgress | undefined;
  const users = new Set<string>();

  for (const event of events) {
    if (event.kind === "user.message") {
      if (!users.has(event.id)) {
        users.add(event.id);
        const nextTurn = event.runId ?? event.id;
        if (nextTurn !== turnId) {
          turnId = nextTurn;
          current = undefined;
        }
      }
      continue;
    }
    if (event.kind !== "plan.update" && event.kind !== "todo.update") continue;
    const data = event.data;
    let items: readonly TaskProgressItem[];
    if (data?.type === "plan") {
      items = data.steps;
    } else if (data?.type === "todo_update") {
      items = data.todos.map((todo) => ({
        id: todo.id,
        title: todo.text,
        status:
          todo.status === "completed"
            ? "done"
            : todo.status === "in_progress"
              ? "active"
              : "pending",
      }));
    } else {
      continue;
    }
    const ids = new Set<string>();
    const readable = items.filter((item) => {
      if (!item.title.trim() || ids.has(item.id)) return false;
      ids.add(item.id);
      return true;
    });
    if (items.length > 0 && readable.length === 0) continue;
    const id = event.runId ?? turnId ?? event.id;
    turnId ??= id;
    if (current && id !== turnId) continue;
    const completedCount = readable.filter((item) => item.status === "done").length;
    const list = {
      id,
      title: data.type === "plan" ? data.title?.trim() || "Tasks" : "Tasks",
      items: readable,
      completedCount,
      isComplete: completedCount === readable.length,
    };
    latest = list;
    if (id === turnId) current = list;
  }

  const selected = current ?? latest;
  if (!selected?.items.length) return undefined;
  return current || !turnId || !selected.isComplete ? selected : undefined;
}
