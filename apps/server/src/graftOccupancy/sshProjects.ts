import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import type { OrchestrationCommand, SshProject, SshProjectAddInput } from "@synara/contracts";
import { Effect } from "effect";

import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine";

export async function addSshProject(
  input: SshProjectAddInput,
  engine: Pick<OrchestrationEngineShape, "getReadModel"> & {
    dispatch: (command: OrchestrationCommand) => Effect.Effect<{ sequence: number }, unknown>;
  },
): Promise<{ project: SshProject }> {
  const requestedPath = input.path.trim();
  const expandedPath =
    requestedPath === "~"
      ? homedir()
      : requestedPath.startsWith("~/")
        ? join(homedir(), requestedPath.slice(2))
        : requestedPath;
  if (!isAbsolute(expandedPath))
    throw new Error("Choose an absolute folder path on the remote computer.");
  const workspaceRoot = await realpath(expandedPath);
  if (!(await stat(workspaceRoot)).isDirectory())
    throw new Error("The selected path is not a folder.");
  const findExisting = async () => {
    const model = await Effect.runPromise(engine.getReadModel());
    return model.projects.find(
      (project) => project.deletedAt === null && project.workspaceRoot === workspaceRoot,
    );
  };
  const existing = await findExisting();
  if (existing) {
    if (existing.kind !== "project")
      throw new Error("This folder belongs to a different workspace type.");
    return { project: { id: existing.id, name: existing.title, path: existing.workspaceRoot } };
  }
  const name = basename(workspaceRoot) || workspaceRoot;
  try {
    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: input.commandId,
        projectId: input.projectId,
        kind: "project",
        title: name,
        workspaceRoot,
        createWorkspaceRootIfMissing: false,
        createdAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    const raced = await findExisting();
    if (!raced || raced.kind !== "project") throw error;
    return { project: { id: raced.id, name: raced.title, path: raced.workspaceRoot } };
  }
  const saved = await findExisting();
  if (!saved || saved.kind !== "project")
    throw new Error("The remote project was not saved. Try adding the folder again.");
  return { project: { id: saved.id, name: saved.title, path: saved.workspaceRoot } };
}
