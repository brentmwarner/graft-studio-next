import type { GraftEnvironmentSnapshot, GraftTimelineEvent } from "@graft/mobile-contract";
import { describe, expect, it } from "vitest";

import { livePhraseFromItems, transcriptLiveStatus } from "./liveStatus";
import {
  buildTranscriptItems,
  groupProjects,
  groupToolRuns,
  mergeTimelineEvents,
  reconcileTranscriptItems,
  type TranscriptItem,
  type TranscriptToolItem,
} from "./mobileViewModels";
import { liveStatusPhrase, toolRunningPhrase } from "./toolPresentation";

function tool(id: string, running = false): TranscriptToolItem {
  return { id, kind: "tool", toolId: id, name: "Bash", detail: "", running };
}

function event(
  cursor: number,
  kind: GraftTimelineEvent["kind"],
  text?: string,
): GraftTimelineEvent {
  return {
    id: `event-${cursor}`,
    cursor,
    kind,
    threadId: "thread-1",
    runId: "run-1",
    createdAt: cursor,
    text,
  };
}

describe("mobile view models", () => {
  it("settles one tool across distinct event IDs and ignores late progress", () => {
    const events = [
      { ...event(1, "tool.start"), toolId: "call-1", toolName: "Read" },
      { ...event(2, "tool.end"), toolId: "call-1" },
      { ...event(3, "tool.update"), toolId: "call-1" },
      { ...event(4, "tool.start"), toolId: "call-1", runId: "run-2" },
    ];
    const items = buildTranscriptItems([], events);
    const tools = items.flatMap((item) =>
      item.kind === "toolGroup" ? item.tools : item.kind === "tool" ? [item] : [],
    );
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ kind: "tool", name: "Read", running: false });
    expect(tools[1]).toMatchObject({ kind: "tool", running: true });
    expect(buildTranscriptItems(events, [])).toEqual(items);
  });

  it("groups and alphabetizes threads under the same projects as iOS", () => {
    const snapshot = {
      projects: [{ id: "project-1", name: "Graft", kind: "repo" }],
      threads: [
        {
          id: "thread-b",
          projectId: "project-1",
          title: "Zebra",
          updatedAt: 2,
        },
        {
          id: "thread-a",
          projectId: "project-1",
          title: "Android parity",
          updatedAt: 1,
          status: "needs_attention",
        },
      ],
      activeRuns: [],
    } as unknown as GraftEnvironmentSnapshot;

    expect(groupProjects(snapshot, "")).toEqual([
      {
        id: "project-1",
        kind: "repo",
        name: "Graft",
        threads: [
          { id: "thread-a", title: "Android parity", showsAttentionDot: true },
          { id: "thread-b", title: "Zebra", showsAttentionDot: false },
        ],
      },
    ]);
  });

  it("folds accumulated streaming deltas into one assistant row", () => {
    const items = buildTranscriptItems(
      [event(1, "user.message", "Make Android match iOS")],
      [
        event(2, "thinking.delta", "Inspecting the views"),
        { ...event(3, "assistant.delta", "I am"), id: "reply" },
        { ...event(4, "assistant.delta", "I am working on it."), id: "reply" },
      ],
    );

    expect(items).toMatchObject([
      { kind: "user", text: "Make Android match iOS" },
      { kind: "assistant", text: "", reasoning: "Inspecting the views", streaming: false },
      {
        kind: "assistant",
        text: "I am working on it.",
        reasoning: "",
        streaming: true,
      },
    ]);
  });

  it("drops live events already covered by a newer snapshot", () => {
    expect(
      mergeTimelineEvents(
        [event(1, "user.message", "Hello"), event(2, "assistant.message", "Hi")],
        [event(2, "assistant.message", "Hi"), event(3, "user.message", "Next")],
        2,
      ).map((item) => item.cursor),
    ).toEqual([1, 2, 3]);
  });

  it("keeps streaming live events a long transcript's synthetic cursors overrun", () => {
    // The host numbers a snapshot's transcript events 1..N off the part-tail
    // length, which for a long thread runs far past the journal cursor those
    // events were taken at. Deriving the "already covered" threshold from the
    // settled events therefore discarded every streamed frame — the transcript
    // only ever advanced on the HTTP snapshot behind it.
    const settled = Array.from({ length: 500 }, (_, index) =>
      event(index + 1, "assistant.message", `settled ${index}`),
    );

    expect(
      mergeTimelineEvents(settled, [event(41, "assistant.delta", "streaming reply")], 40).at(-1),
    ).toMatchObject({ text: "streaming reply" });
  });

  it("still drops streamed frames the snapshot already accounts for", () => {
    const settled = Array.from({ length: 500 }, (_, index) =>
      event(index + 1, "assistant.message", `settled ${index}`),
    );

    expect(
      mergeTimelineEvents(settled, [event(39, "assistant.delta", "already settled")], 40),
    ).toHaveLength(500);
  });

  it("folds a run of tool calls into one row", () => {
    const message: TranscriptItem = {
      id: "a1",
      kind: "assistant",
      text: "hi",
      reasoning: "",
      streaming: false,
    };

    expect(
      groupToolRuns([message, tool("t1"), tool("t2"), tool("t9", true)]).map((row) => row.kind),
    ).toEqual(["assistant", "toolGroup"]);
  });

  it("does not split a tool run on interleaved thinking or status", () => {
    const thinking: TranscriptItem = {
      id: "think-1",
      kind: "assistant",
      text: "",
      reasoning: "Need to grep the composer next.",
      streaming: false,
    };
    const status: TranscriptItem = {
      id: "status-1",
      kind: "activity",
      eventId: "st-1",
      text: "Working",
    };

    expect(
      groupToolRuns([tool("t1"), thinking, tool("t2"), status, tool("t9")]).map((row) => row.kind),
    ).toEqual(["toolGroup"]);
  });

  it("leaves a lone tool call as its own row", () => {
    expect(groupToolRuns([tool("t1")]).map((row) => row.kind)).toEqual(["tool"]);
  });

  it("does not fold across an interleaved message", () => {
    const message: TranscriptItem = {
      id: "a1",
      kind: "assistant",
      text: "between",
      reasoning: "",
      streaming: false,
    };

    expect(
      groupToolRuns([tool("t1"), tool("t2"), message, tool("t9"), tool("t4")]).map(
        (row) => row.kind,
      ),
    ).toEqual(["toolGroup", "assistant", "toolGroup"]);
  });

  it("keeps the folded group pointing at the live tool objects", () => {
    // The builder keeps mutating tool items as `tool.update`/`tool.end` land,
    // so the group must hold those same objects, not copies.
    const live = tool("t1", true);
    const [group] = groupToolRuns([live, tool("t2", true)]);

    live.running = false;

    expect(group?.kind === "toolGroup" && group.tools[0]?.running).toBe(false);
  });

  it("revises a plan in place instead of stacking a card per update", () => {
    // The host re-emits the whole plan under the same part id every time a
    // step flips. Appending would run a dozen near-identical plan cards down
    // the turn.
    function plan(done: number): GraftTimelineEvent {
      return {
        ...event(1, "plan.update", "Plan updated"),
        id: "part-plan",
        data: {
          type: "plan",
          title: "Ship it",
          steps: [
            { id: "s1", title: "Write", status: done > 0 ? "done" : "active" },
            { id: "s2", title: "Test", status: done > 1 ? "done" : "pending" },
          ],
        },
      };
    }

    const items = buildTranscriptItems([], [plan(0), plan(1), plan(2)], 0);
    const activity = items.filter((item) => item.kind === "activity");
    expect(activity).toHaveLength(1);
    expect(
      activity[0]?.kind === "activity" &&
        activity[0].data?.type === "plan" &&
        activity[0].data.steps.every((step) => step.status === "done"),
    ).toBe(true);
  });

  it("redraws a revised plan rather than reusing the settled row", () => {
    // reconcileTranscriptItems keeps object identity for unchanged rows so the
    // memoized cards can bail out. If it called two plan versions equal, the
    // card would freeze on whichever arrived first.
    function planItem(status: "pending" | "done") {
      return buildTranscriptItems(
        [],
        [
          {
            ...event(1, "plan.update", "Plan updated"),
            id: "part-plan",
            data: {
              type: "plan",
              steps: [{ id: "s1", title: "Write", status }],
            },
          },
        ],
        0,
      );
    }

    const before = planItem("pending");
    const after = reconcileTranscriptItems(before, planItem("done"));
    expect(after[0]).not.toBe(before[0]);
  });

  it("keeps transient status out of transcript rows", () => {
    const items = buildTranscriptItems(
      [],
      [{ ...event(1, "status", "Compacting conversation") }],
      0,
    );
    expect(items).toEqual([]);
  });

  it("removes a transient status when the run produces visible output", () => {
    const status = {
      ...event(1, "status", "Planning dependency fixes"),
      runId: "run-1",
    };
    const answer = {
      ...event(2, "assistant.message", "The dependencies are fixed."),
      runId: "run-1",
    };

    expect(buildTranscriptItems([status, answer], [])).toEqual([
      expect.objectContaining({
        kind: "assistant",
        text: "The dependencies are fixed.",
      }),
    ]);
  });

  it("keeps repeated user turns that are genuinely separate", () => {
    // Content-based dedup used to scan the whole settled transcript, so a user
    // who legitimately sent the same text twice — "continue", with a reply in
    // between — permanently lost the second turn.
    const items = buildTranscriptItems(
      [
        event(1, "user.message", "continue"),
        event(2, "assistant.message", "Working on it"),
        event(3, "user.message", "continue"),
      ],
      [],
    );

    expect(items.filter((item) => item.kind === "user")).toHaveLength(2);
  });

  it("reconciles the optimistic echo against its authoritative turn", () => {
    // `sendMessage` appends a local echo at cursor 0 so the turn paints before
    // the round trip. Once the snapshot settles the real event, the echo must
    // collapse into it rather than render a second identical bubble.
    const optimistic: GraftTimelineEvent = {
      id: "optimistic-uuid",
      cursor: 0,
      kind: "user.message",
      threadId: "thread-1",
      createdAt: 10,
      text: "continue",
    };

    const items = buildTranscriptItems([event(1, "user.message", "continue")], [optimistic]);

    expect(items.filter((item) => item.kind === "user")).toHaveLength(1);
  });

  it("reconciles a live authoritative turn that arrives after its optimistic echo", () => {
    const optimistic: GraftTimelineEvent = {
      id: "optimistic-uuid",
      cursor: 0,
      kind: "user.message",
      threadId: "thread-1",
      createdAt: 10,
      text: "continue",
    };

    const items = buildTranscriptItems([], [optimistic, event(1, "user.message", "continue")]);

    expect(items.filter((item) => item.kind === "user")).toHaveLength(1);
  });

  it("reconciles a lingering optimistic echo after the settled response", () => {
    const optimistic: GraftTimelineEvent = {
      id: "optimistic-uuid",
      cursor: 0,
      kind: "user.message",
      threadId: "thread-1",
      createdAt: 10,
      text: "continue",
    };

    const items = buildTranscriptItems(
      [event(1, "user.message", "continue"), event(2, "assistant.message", "Done")],
      [optimistic],
    );

    expect(items.filter((item) => item.kind === "user")).toHaveLength(1);
  });

  it("does not repeat a settled response still present in the live tail", () => {
    const optimistic: GraftTimelineEvent = {
      id: "optimistic-uuid",
      cursor: 0,
      kind: "user.message",
      threadId: "thread-1",
      createdAt: 10,
      text: "continue",
    };

    const items = buildTranscriptItems(
      [event(1, "user.message", "continue"), event(2, "assistant.message", "Done")],
      [optimistic, { ...event(3, "assistant.delta", "Done"), id: "event-2" }],
    );

    expect(items.filter((item) => item.kind === "assistant")).toHaveLength(1);
  });

  it("shows the optimistic echo before its turn has settled", () => {
    const optimistic: GraftTimelineEvent = {
      id: "optimistic-uuid",
      cursor: 0,
      kind: "user.message",
      threadId: "thread-1",
      createdAt: 10,
      text: "continue",
    };

    expect(buildTranscriptItems([], [optimistic])).toMatchObject([
      { kind: "user", text: "continue" },
    ]);
  });

  it("keeps every row id unique so FlatList keys never collide", () => {
    // A settled run and its still-streaming live tail both derive their row id
    // from the same runId; duplicate keys make FlatList stop updating rows.
    const items = buildTranscriptItems(
      [event(1, "user.message", "Go"), event(2, "assistant.delta", "Settled reply")],
      [event(3, "tool.start", "reading"), event(4, "assistant.delta", "Live continuation")],
    );

    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(items.filter((item) => item.kind === "assistant")).toHaveLength(2);
  });

  it("reuses unchanged rows so only the streaming tail re-renders", () => {
    const settled = [event(1, "user.message", "Go"), event(2, "assistant.message", "First answer")];
    const before = buildTranscriptItems(settled, [event(3, "assistant.delta", "Partial")]);
    const after = buildTranscriptItems(settled, [event(3, "assistant.delta", "Partial answer")]);

    const reconciled = reconcileTranscriptItems(before, after);

    expect(reconciled[0]).toBe(before[0]);
    expect(reconciled[1]).toBe(before[1]);
    expect(reconciled[2]).not.toBe(before[2]);
    expect(reconciled[2]).toMatchObject({ text: "Partial answer" });
  });

  it("returns the previous array when a snapshot changes nothing", () => {
    const settled = [event(1, "user.message", "Go"), event(2, "assistant.message", "Answer")];
    const before = buildTranscriptItems(settled, []);
    const identical = buildTranscriptItems(settled, []);

    expect(reconcileTranscriptItems(before, identical)).toBe(before);
  });

  it("is idempotent, so a repeated render never churns row identity", () => {
    const settled = [event(1, "user.message", "Go")];
    const first = reconcileTranscriptItems([], buildTranscriptItems(settled, []));
    const second = reconcileTranscriptItems(first, buildTranscriptItems(settled, []));

    expect(second).toBe(first);
  });
});

describe("live status phrases", () => {
  it("defaults to thinking", () => {
    expect(liveStatusPhrase()).toBe("Thinking");
    expect(liveStatusPhrase("   ")).toBe("Thinking");
    expect(liveStatusPhrase(undefined, "", "  ")).toBe("Thinking");
    expect(livePhraseFromItems([])).toBe("Thinking");
  });

  it("maps running tools to action phrases", () => {
    expect(toolRunningPhrase("bash")).toBe("Running a command");
    expect(toolRunningPhrase("read")).toBe("Reading files");
    expect(toolRunningPhrase("write")).toBe("Editing a file");
    expect(toolRunningPhrase("web_search")).toBe("Searching the web");
    expect(toolRunningPhrase("  Image  ")).toBe("Looking at an image");
    expect(toolRunningPhrase("fetch", "https://nytimes.com/story")).toBe("Reading nytimes.com");
    expect(toolRunningPhrase("fetch", 'fetch({"url":"https://example.com"})')).toBe(
      "Reading example.com",
    );
  });

  it("tracks the latest running tool in the transcript", () => {
    expect(
      livePhraseFromItems([
        tool("t1", false),
        { ...tool("t2", true), name: "read", detail: "ToolActivity.tsx" },
      ]),
    ).toBe("Reading files");
  });

  it("uses the latest running tool inside a group", () => {
    expect(
      livePhraseFromItems([
        {
          id: "g1",
          kind: "toolGroup",
          tools: [
            { ...tool("t1", true), name: "read" },
            { ...tool("t2", true), name: "bash" },
          ],
        },
      ]),
    ).toBe("Running a command");
  });

  it("ignores a stale running tool from an earlier turn", () => {
    expect(
      livePhraseFromItems([
        { ...tool("t1", true), name: "bash" },
        { id: "u2", kind: "user", text: "Try again" },
      ]),
    ).toBe("Thinking");
  });

  it("shows one status only while working without visible reply text", () => {
    const input = { items: [], isWorking: true, isConnected: true, needsInput: false };
    expect(transcriptLiveStatus(input)).toEqual({ phrase: "Thinking", animating: true });
    expect(transcriptLiveStatus({ ...input, isWorking: false })).toBeNull();
    expect(transcriptLiveStatus({ ...input, isConnected: false })).toEqual({
      phrase: "Reconnecting…",
      animating: false,
    });
    expect(transcriptLiveStatus({ ...input, needsInput: true })).toEqual({
      phrase: "Waiting for you",
      animating: false,
    });
    for (const streaming of [true, false]) {
      expect(
        transcriptLiveStatus({
          ...input,
          items: [{ id: "a", kind: "assistant", text: "Answer", reasoning: "", streaming }],
        }),
      ).toBeNull();
    }
  });
});

it("keeps attachment-only messages and folds their optimistic upload echo", () => {
  const attachment = {
    id: "local-file",
    type: "file" as const,
    name: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 10,
  };
  const optimistic: GraftTimelineEvent = {
    id: "local",
    cursor: 0,
    kind: "user.message",
    threadId: "thread-1",
    createdAt: 1,
    text: "",
    attachments: [attachment],
  };
  const authoritative = {
    ...optimistic,
    id: "host",
    cursor: 2,
    attachments: [{ ...attachment, id: "host-file" }],
  };
  const items = buildTranscriptItems([authoritative], [optimistic], 0);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    kind: "user",
    text: "",
    attachments: [expect.objectContaining({ name: "notes.txt" })],
  });
});
