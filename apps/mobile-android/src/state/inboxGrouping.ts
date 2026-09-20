import type { GraftEnvironmentSnapshot } from "@graft/mobile-contract";

import { threadActivity, type ThreadReadState } from "./threadActivity";
import { groupProjects, type InboxThreadItem } from "./mobileViewModels";

export const inboxViewModes = ["priority", "project", "chronological"] as const;
export type InboxViewMode = (typeof inboxViewModes)[number];

export function parseInboxViewMode(value: string | null): InboxViewMode {
  return inboxViewModes.find((mode) => mode === value) ?? "project";
}

export interface InboxThreadEntry {
  readonly thread: InboxThreadItem;
  readonly projectName?: string;
}

export interface InboxThreadSection {
  readonly id: string;
  readonly title: string;
  readonly threads: readonly InboxThreadEntry[];
}

/** Recent work, with requests and active runs first, matching the native drawer. */
export function recentInboxThreads(
  snapshot: GraftEnvironmentSnapshot | null,
  reads: ThreadReadState = {},
  limit = 10,
): readonly InboxThreadItem[] {
  if (!snapshot) return [];
  const rank = (thread: GraftEnvironmentSnapshot["threads"][number]) => {
    const activity = threadActivity(thread, snapshot, reads);
    return activity === "needs_attention" ? 0 : activity === "working" ? 1 : 2;
  };
  return snapshot.threads
    .filter(
      (thread) =>
        rank(thread) < 2 || !["new thread", "untitled"].includes(thread.title.toLowerCase()),
    )
    .toSorted((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((thread) => ({
      id: thread.id,
      title: thread.title,
      activity: threadActivity(thread, snapshot, reads),
    }));
}

/** Host timestamps are milliseconds; calendar boundaries use the device's local time. */
export function groupInboxThreads(
  snapshot: GraftEnvironmentSnapshot | null,
  mode: InboxViewMode,
  searchQuery: string,
  now = new Date(),
  reads: ThreadReadState = {},
): readonly InboxThreadSection[] {
  if (!snapshot || mode === "project") return [];
  const projects = new Map(snapshot.projects.map((project) => [project.id, project.name]));
  const matchingIds = new Set(
    groupProjects(snapshot, searchQuery, reads).flatMap((project) =>
      project.threads.map((item) => item.id),
    ),
  );
  const decisions = new Set([
    ...snapshot.pendingApprovals.map((request) => request.threadId),
    ...snapshot.pendingQuestions.map((request) => request.threadId),
  ]);
  const active = new Set(snapshot.activeRuns.map((run) => run.threadId));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const week = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);

  function rank(thread: GraftEnvironmentSnapshot["threads"][number]): number {
    if (decisions.has(thread.id) || thread.status === "needs_attention") return 0;
    if (active.has(thread.id) || thread.status === "running") return 1;
    return 2;
  }

  const threads = snapshot.threads
    .filter((thread) => matchingIds.has(thread.id))
    .toSorted((left, right) => {
      if (mode === "priority" && rank(left) !== rank(right)) return rank(left) - rank(right);
      return right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
    });
  const buckets = new Map<string, InboxThreadEntry[]>();
  for (const thread of threads) {
    const key =
      mode === "priority" && rank(thread) < 2
        ? "priority"
        : thread.updatedAt >= today.getTime()
          ? "today"
          : thread.updatedAt >= yesterday.getTime()
            ? "yesterday"
            : thread.updatedAt >= week.getTime()
              ? "week"
              : "older";
    const entries = buckets.get(key) ?? [];
    entries.push({
      thread: {
        id: thread.id,
        title: thread.title,
        activity: threadActivity(thread, snapshot, reads),
      },
      projectName: projects.get(thread.projectId),
    });
    buckets.set(key, entries);
  }
  return (
    [
      ["priority", "Priority"],
      ["today", "Today"],
      ["yesterday", "Yesterday"],
      ["week", "Previous 7 days"],
      ["older", "Older"],
    ] as const
  ).flatMap(([id, title]) => {
    const entries = buckets.get(id);
    return entries?.length ? [{ id, title, threads: entries }] : [];
  });
}
