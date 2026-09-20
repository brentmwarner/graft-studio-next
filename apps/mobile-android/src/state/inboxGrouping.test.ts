import type { GraftEnvironmentSnapshot } from "@graft/mobile-contract";
import { describe, expect, it } from "vitest";

import { groupInboxThreads, parseInboxViewMode, recentInboxThreads } from "./inboxGrouping";

const now = new Date(2026, 8, 20, 12);
const date = (day: number, hour = 0) => new Date(2026, 8, day, hour).getTime();
const thread = (
  id: string,
  updatedAt: number,
  status: GraftEnvironmentSnapshot["threads"][number]["status"] = "idle",
  projectId = "graft",
) => ({
  id,
  title: id,
  updatedAt,
  status,
  projectId,
});
const snapshot: GraftEnvironmentSnapshot = {
  environment: {
    id: "mac",
    label: "Mac",
    hostVersion: "1",
    protocolVersion: 1,
    capabilities: [],
    cursor: 1,
  },
  projects: [
    { id: "graft", name: "Graft", kind: "repo" },
    { id: "empty", name: "Empty", kind: "repo" },
  ],
  threads: [
    thread("old-active", date(1)),
    thread("yesterday", date(19)),
    thread("week", date(13)),
    thread("older", date(12, 23)),
    thread("today-midnight", date(20)),
    thread("today-newest", date(20, 11)),
    thread("approval", date(2)),
    thread("question", date(3), "idle", "missing"),
    thread("status-attention", date(4), "needs_attention"),
    thread("status-running", date(5), "running"),
  ],
  activeRuns: [
    {
      id: "run",
      threadId: "old-active",
      projectId: "graft",
      status: "running",
      startedAt: date(1),
    },
  ],
  pendingApprovals: [{ id: "approve", threadId: "approval", title: "Review", createdAt: date(2) }],
  pendingQuestions: [{ id: "ask", threadId: "question", prompt: "Choose", createdAt: date(3) }],
  selectedTranscript: null,
  cursor: 1,
};

describe("inbox views", () => {
  it("uses calendar buckets with newest threads first and preserves every thread once", () => {
    const sections = groupInboxThreads(snapshot, "chronological", "", now);
    expect(sections.map((section) => section.title)).toEqual([
      "Today",
      "Yesterday",
      "Previous 7 days",
      "Older",
    ]);
    expect(
      sections.slice(0, 3).map((section) => section.threads.map((entry) => entry.thread.id)),
    ).toEqual([["today-newest", "today-midnight"], ["yesterday"], ["week"]]);
    expect(
      new Set(sections.flatMap((section) => section.threads.map((entry) => entry.thread.id))).size,
    ).toBe(snapshot.threads.length);
  });

  it("ranks decisions before running work and excludes priority rows from date sections", () => {
    const sections = groupInboxThreads(snapshot, "priority", "", now);
    expect(sections[0]?.threads.map((entry) => entry.thread.id)).toEqual([
      "status-attention",
      "question",
      "approval",
      "status-running",
      "old-active",
    ]);
    expect(
      sections[0]?.threads.every((entry) =>
        ["working", "needs_attention"].includes(entry.thread.activity),
      ),
    ).toBe(true);
    expect(sections.flatMap((section) => section.threads)).toHaveLength(snapshot.threads.length);
    expect(
      sections[0]?.threads.find((entry) => entry.thread.id === "question")?.projectName,
    ).toBeUndefined();
  });

  it("searches both titles and projects, including threads whose project is missing", () => {
    expect(
      groupInboxThreads(snapshot, "priority", " QUESTION ", now)[0]?.threads[0]?.thread.id,
    ).toBe("question");
    expect(
      groupInboxThreads(snapshot, "chronological", "graft", now).flatMap(
        (section) => section.threads,
      ),
    ).toHaveLength(9);
    expect(groupInboxThreads(snapshot, "chronological", "no match", now)).toEqual([]);
    expect(groupInboxThreads(snapshot, "chronological", "empty", now)).toEqual([]);
    expect(groupInboxThreads(null, "priority", "", now)).toEqual([]);
  });

  it("defaults to projects when the saved choice is missing or unknown", () => {
    expect(parseInboxViewMode(null)).toBe("project");
    expect(parseInboxViewMode("unknown")).toBe("project");
    expect(parseInboxViewMode("priority")).toBe("priority");
    expect(parseInboxViewMode("chronological")).toBe("chronological");
  });

  it("uses local midnight across daylight saving changes", () => {
    const dstNow = new Date(2026, 2, 9, 12);
    const dst = {
      ...snapshot,
      threads: [thread("yesterday", new Date(2026, 2, 8, 0, 30).getTime())],
    };
    expect(groupInboxThreads(dst, "chronological", "", dstNow)[0]?.title).toBe("Yesterday");
  });
});

it("keeps active and attention threads in Recents ahead of recent idle work", () => {
  const recent = recentInboxThreads(snapshot, { "today-newest": { completedAt: 5, viewedAt: 0 } });
  expect(recent.slice(0, 5).map((item) => item.activity)).toEqual([
    "needs_attention",
    "needs_attention",
    "needs_attention",
    "working",
    "working",
  ]);
  expect(recent.find((item) => item.id === "today-newest")?.activity).toBe("unread");
  expect(recentInboxThreads(snapshot, {}, 2)).toHaveLength(2);
});

it("sorts fresh arrays without mutating the snapshot when modern copy-sort APIs are unavailable", () => {
  const original = snapshot.threads.map((thread) => thread.id);
  const copySort = Object.getOwnPropertyDescriptor(Array.prototype, "toSorted");
  Object.defineProperty(Array.prototype, "toSorted", { configurable: true, value: undefined });
  try {
    expect(recentInboxThreads(snapshot)).toHaveLength(10);
    expect(groupInboxThreads(snapshot, "chronological", "", now)).not.toHaveLength(0);
    expect(snapshot.threads.map((thread) => thread.id)).toEqual(original);
  } finally {
    if (copySort) Object.defineProperty(Array.prototype, "toSorted", copySort);
    else Reflect.deleteProperty(Array.prototype, "toSorted");
  }
});
