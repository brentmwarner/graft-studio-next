import type { GraftEnvironmentSnapshot, GraftSessionCredential } from "@graft/mobile-contract";
import { describe, expect, it } from "vitest";
import { groupProjects } from "./mobileViewModels";
import { groupInboxThreads, recentInboxThreads } from "./inboxGrouping";
import {
  machineInbox,
  machineResourceId,
  parseMachineResourceId,
  type MachineInboxSource,
} from "./machineInbox";

const session = (id: string): GraftSessionCredential => ({
  environmentId: id,
  environmentLabel: id,
  sessionId: `session-${id}`,
  deviceId: "device-12345678",
  bearerToken: "bearer-12345678",
  protocolVersion: 1,
  capabilities: [],
  httpBaseUrl: "https://host.test",
  wsBaseUrl: "wss://host.test",
  expiresAt: null,
});
function machine(id: string, connected = true): MachineInboxSource {
  const snapshot: GraftEnvironmentSnapshot = {
    environment: {
      id,
      label: id,
      hostVersion: "1",
      protocolVersion: 1,
      capabilities: [],
      cursor: 5,
    },
    projects: [{ id: "same-project", name: "Graft", kind: "repo" }],
    threads: [
      {
        id: "same-thread",
        projectId: "same-project",
        title: id,
        updatedAt: 100,
        status: "running",
      },
    ],
    activeRuns: [{ id: "same-run", threadId: "same-thread", status: "running", startedAt: 100 }],
    pendingApprovals: [],
    pendingQuestions: [],
    selectedTranscript: null,
    cursor: 5,
  };
  return {
    session: session(id),
    snapshot,
    connectionState: connected ? "connected" : "disconnected",
    reads: { "same-thread": { completedAt: 99, viewedAt: connected ? 99 : 0 } },
  };
}
describe("multi-machine inbox", () => {
  it("keeps equal wire IDs separate, scopes reads, and reversibly routes to their owner", () => {
    const sources = [machine("a"), machine("b", false)];
    const before = JSON.stringify(sources);
    const inbox = machineInbox(sources);
    const groups = groupProjects(inbox.snapshot, "", inbox.reads);
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((group) => group.id)).size).toBe(2);
    expect(groups.map((group) => group.threads[0]?.activity)).toEqual(["working", "unread"]);
    expect(parseMachineResourceId(groups[1]!.threads[0]!.id)).toEqual({
      environmentId: "b",
      resourceId: "same-thread",
    });
    expect(JSON.stringify(sources)).toBe(before);
    expect(inbox.snapshot?.selectedTranscript).toBeNull();
  });
  it("filters all views and search without changing the connections", () => {
    const sources = [machine("a"), machine("b")];
    const filtered = machineInbox(sources, "b");
    expect(groupProjects(filtered.snapshot, "Graft")[0]?.threads).toHaveLength(1);
    expect(recentInboxThreads(filtered.snapshot)[0]?.id).toBe(
      machineResourceId("b", "same-thread"),
    );
    expect(groupInboxThreads(filtered.snapshot, "priority", "")[0]?.threads).toHaveLength(1);
    expect(machineInbox(sources).snapshot?.threads).toHaveLength(2);
    expect(machineInbox(sources, "missing").snapshot).toBeNull();
  });
  it("does not animate stale active runs or put sleeping hosts into Priority", () => {
    const source = machine("off", false);
    const inbox = machineInbox([source]);
    expect(inbox.snapshot?.activeRuns).toEqual([]);
    expect(
      groupInboxThreads(inbox.snapshot, "priority", "", new Date(), inbox.reads).some(
        (section) => section.id === "priority",
      ),
    ).toBe(false);
    expect(recentInboxThreads(inbox.snapshot, inbox.reads)[0]?.activity).toBe("unread");
    expect(
      machineInbox([{ ...source, connectionState: "connected" }]).snapshot?.activeRuns,
    ).toHaveLength(1);
  });
  it("round-trips punctuation without delimiter collisions", () => {
    expect(machineResourceId("a:b", "c")).not.toBe(machineResourceId("a", "b:c"));
    expect(parseMachineResourceId(machineResourceId('a"b', "[]:thread"))).toEqual({
      environmentId: 'a"b',
      resourceId: "[]:thread",
    });
    expect(parseMachineResourceId('["one"]')).toBeUndefined();
    expect(parseMachineResourceId("raw-thread")).toBeUndefined();
  });
});
