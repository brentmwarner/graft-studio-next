import type { GraftEnvironmentSnapshot, GraftSessionCredential } from "@graft/mobile-contract";
import type { GatewayConnectionState } from "../api/gatewaySocket";
import type { ThreadReadState } from "./threadActivity";

export interface MachineInboxSource {
  readonly session: GraftSessionCredential;
  readonly snapshot: GraftEnvironmentSnapshot | null;
  readonly connectionState: GatewayConnectionState;
  readonly reads: ThreadReadState;
}
export const machineResourceId = (environmentId: string, resourceId: string): string =>
  JSON.stringify([environmentId, resourceId]);
export function parseMachineResourceId(
  value: string,
): { environmentId: string; resourceId: string } | undefined {
  try {
    const parts: unknown = JSON.parse(value);
    if (
      Array.isArray(parts) &&
      parts.length === 2 &&
      typeof parts[0] === "string" &&
      typeof parts[1] === "string"
    )
      return { environmentId: parts[0], resourceId: parts[1] };
  } catch {
    /* Not a scoped inbox resource. */
  }
  return undefined;
}
/** Presentation only. Commands always use the original IDs on the owning session. */
export function machineInbox(
  machines: readonly MachineInboxSource[],
  filter?: string,
): { snapshot: GraftEnvironmentSnapshot | null; reads: ThreadReadState } {
  const visible = machines.filter((machine) => !filter || machine.session.environmentId === filter);
  const first = visible.find((machine) => machine.snapshot)?.snapshot;
  if (!first) return { snapshot: null, reads: {} };
  const reads: Record<string, ThreadReadState[string]> = {};
  const snapshots = visible.flatMap((machine) => {
    const snapshot = machine.snapshot;
    if (!snapshot) return [];
    const scope = (id: string) => machineResourceId(machine.session.environmentId, id);
    const online = machine.connectionState === "connected";
    for (const [id, receipt] of Object.entries(machine.reads)) reads[scope(id)] = receipt;
    return [
      {
        ...snapshot,
        projects: snapshot.projects.map((project) => ({
          ...project,
          id: scope(project.id),
          name:
            visible.length > 1
              ? `${project.name} · ${machine.session.environmentLabel}`
              : project.name,
        })),
        threads: snapshot.threads.map((thread) => ({
          ...thread,
          id: scope(thread.id),
          projectId: scope(thread.projectId),
          ...(!online ? { status: "idle" as const } : {}),
        })),
        activeRuns: online
          ? snapshot.activeRuns.map((run) => ({
              ...run,
              id: scope(run.id),
              threadId: scope(run.threadId),
            }))
          : [],
        pendingApprovals: online
          ? snapshot.pendingApprovals.map((request) => ({
              ...request,
              id: scope(request.id),
              threadId: scope(request.threadId),
            }))
          : [],
        pendingQuestions: online
          ? snapshot.pendingQuestions.map((request) => ({
              ...request,
              id: scope(request.id),
              threadId: scope(request.threadId),
            }))
          : [],
      },
    ];
  });
  return {
    reads,
    snapshot: {
      ...first,
      projects: snapshots.flatMap((snapshot) => snapshot.projects),
      threads: snapshots.flatMap((snapshot) => snapshot.threads),
      activeRuns: snapshots.flatMap((snapshot) => snapshot.activeRuns),
      pendingApprovals: snapshots.flatMap((snapshot) => snapshot.pendingApprovals),
      pendingQuestions: snapshots.flatMap((snapshot) => snapshot.pendingQuestions),
      selectedTranscript: null,
    },
  };
}
