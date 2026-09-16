import type { GraftTimelineEvent } from "@graft/mobile-contract";
import { describe, expect, it } from "vitest";
import { deriveTaskProgress } from "./taskProgress";

const user = (runId: string): GraftTimelineEvent => ({
  id: `user-${runId}`,
  cursor: 0,
  kind: "user.message",
  createdAt: 0,
  threadId: "thread-1",
  runId,
});
const tasks = (
  runId: string,
  statuses: readonly ("pending" | "in_progress" | "completed")[],
): GraftTimelineEvent => ({
  id: `tasks-${runId}`,
  cursor: 0,
  kind: "todo.update",
  createdAt: 0,
  threadId: "thread-1",
  runId,
  data: {
    type: "todo_update",
    todos: statuses.map((status, index) => ({
      id: `task-${index}`,
      text: `Task ${index}`,
      status,
    })),
  },
});

describe("task progress", () => {
  it("reconciles progress without changing task identity", () => {
    const first = tasks("1", ["completed", "in_progress"]);
    const final = tasks("1", ["completed", "completed"]);
    const progress = deriveTaskProgress([user("1"), first, final]);
    expect(progress).toMatchObject({ id: "1", completedCount: 2, isComplete: true });
    expect(progress?.items.map((item) => item.id)).toEqual(["task-0", "task-1"]);
  });
  it("carries unfinished work into followups and hides prior completed work", () => {
    expect(deriveTaskProgress([user("1"), tasks("1", ["pending"]), user("2")])?.id).toBe("1");
    expect(deriveTaskProgress([user("1"), tasks("1", ["completed"]), user("2")])).toBeUndefined();
  });
  it("prefers the current turn over late events from an earlier run", () => {
    const progress = deriveTaskProgress([
      user("1"),
      tasks("1", ["pending"]),
      user("2"),
      tasks("2", ["in_progress"]),
      tasks("1", ["completed"]),
    ]);
    expect(progress).toMatchObject({ id: "2", completedCount: 0 });
  });
  it("clears explicit empty lists but preserves tasks on an unrecognized payload", () => {
    const first = [user("1"), tasks("1", ["pending"])];
    expect(
      deriveTaskProgress([...first, { ...tasks("1", []), data: undefined }])?.items,
    ).toHaveLength(1);
    expect(deriveTaskProgress([...first, tasks("1", [])])).toBeUndefined();
  });
  it("supports named plans and removes duplicate IDs", () => {
    const plan: GraftTimelineEvent = {
      id: "plan",
      cursor: 0,
      kind: "plan.update",
      createdAt: 0,
      threadId: "thread-1",
      data: {
        type: "plan",
        title: "Release",
        steps: [
          { id: "a", title: "Check", status: "done" },
          { id: "a", title: "Duplicate", status: "pending" },
          { id: "b", title: "Ship", status: "active" },
        ],
      },
    };
    expect(deriveTaskProgress([plan])).toMatchObject({ title: "Release", completedCount: 1 });
    expect(deriveTaskProgress([plan])?.items).toHaveLength(2);
  });
});
