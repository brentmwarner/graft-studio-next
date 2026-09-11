import type {
  GraftDesktopCommandEnvelope,
  GraftDesktopJsonValue,
  GraftDesktopSessionRecord,
} from "@graft/desktop-contract";
import { OccupancyCommandError } from "@graft/occupancy";
import type { OrchestrationShellSnapshot } from "@synara/contracts";

export async function dispatchOccupancyCommand(
  loadShell: () => Promise<OrchestrationShellSnapshot>,
  _session: GraftDesktopSessionRecord,
  command: GraftDesktopCommandEnvelope,
): Promise<GraftDesktopJsonValue | undefined> {
  if (command.type !== "project/list" && command.type !== "thread/list") {
    throw new OccupancyCommandError(
      "unknown_command",
      "This desktop host command is not implemented on this Synara occupancy adapter",
    );
  }
  const shell = await loadShell();
  if (command.type === "project/list") {
    return {
      projects: shell.projects.map((project) => ({
        id: project.id,
        name: project.title,
        ...(project.kind === undefined ? {} : { kind: project.kind }),
        path: project.workspaceRoot,
      })),
    };
  }
  return {
    threads: shell.threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      projectId: thread.projectId,
    })),
  };
}
