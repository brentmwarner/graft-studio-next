import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import type { OrchestrationCommand, SshProject, SshProjectAddInput } from "@graft/contracts";
import { Effect } from "effect";

import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine";
import { OrchestrationCommandInvariantError } from "../orchestration/Errors";
import type { ServerRuntimeStartupShape } from "../serverRuntimeStartup";

type SshProjectEngine = Pick<OrchestrationEngineShape, "getReadModel"> & {
  dispatch: (command: OrchestrationCommand) => Effect.Effect<{ sequence: number }, unknown>;
};

export class SshProjectInputError extends Error {}

export function toSshProjectPathError(error: unknown): unknown {
  if (error instanceof Error && "code" in error) {
    if (error.code === "ENOENT") {
      return new SshProjectInputError("The selected folder does not exist.");
    }
    if (error.code === "ENOTDIR") {
      return new SshProjectInputError("The selected path is not a folder.");
    }
    if (error.code === "ENAMETOOLONG" || error.code === "ELOOP") {
      return new SshProjectInputError("The selected folder path cannot be resolved.");
    }
  }
  return error;
}

const pendingAdds = new WeakMap<SshProjectEngine, Map<string, Promise<void>>>();

async function serializeProjectAdd<A>(
  engine: SshProjectEngine,
  workspaceRoot: string,
  operation: () => Promise<A>,
): Promise<A> {
  const pending = pendingAdds.get(engine) ?? new Map<string, Promise<void>>();
  pendingAdds.set(engine, pending);
  const previous = pending.get(workspaceRoot);
  const next = Promise.withResolvers<void>();
  pending.set(workspaceRoot, next.promise);
  await previous;
  try {
    return await operation();
  } finally {
    next.resolve();
    if (pending.get(workspaceRoot) === next.promise) {
      pending.delete(workspaceRoot);
      if (pending.size === 0) pendingAdds.delete(engine);
    }
  }
}

export async function addSshProject(
  input: SshProjectAddInput,
  engine: SshProjectEngine,
  enqueueCommand: ServerRuntimeStartupShape["enqueueCommand"] = (effect) => effect,
): Promise<{ project: SshProject }> {
  const requestedPath = input.path.trim();
  const expandedPath =
    requestedPath === "~"
      ? homedir()
      : requestedPath.startsWith("~/")
        ? join(homedir(), requestedPath.slice(2))
        : requestedPath;
  if (!isAbsolute(expandedPath) || expandedPath.includes("\0"))
    throw new SshProjectInputError("Choose an absolute folder path on the remote computer.");
  const workspaceRoot = await realpath(expandedPath).catch((error) => {
    throw toSshProjectPathError(error);
  });
  const stats = await stat(workspaceRoot).catch((error) => {
    throw toSshProjectPathError(error);
  });
  if (!stats.isDirectory()) throw new SshProjectInputError("The selected path is not a folder.");

  // Keep the stable engine identity: a second create can retire the first threadless project.
  return serializeProjectAdd(engine, workspaceRoot, async () => {
    const findExisting = async () => {
      const model = await Effect.runPromise(engine.getReadModel());
      return model.projects.find(
        (project) => project.deletedAt === null && project.workspaceRoot === workspaceRoot,
      );
    };
    const existing = await findExisting();
    if (existing) {
      if (existing.kind !== "project")
        throw new SshProjectInputError("This folder belongs to a different workspace type.");
      return { project: { id: existing.id, name: existing.title, path: existing.workspaceRoot } };
    }
    const name = basename(workspaceRoot) || workspaceRoot;
    try {
      await Effect.runPromise(
        enqueueCommand(
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
        ),
      );
    } catch (error) {
      if (!(error instanceof OrchestrationCommandInvariantError)) throw error;
      const raced = await findExisting();
      if (!raced || raced.kind !== "project") throw error;
      return { project: { id: raced.id, name: raced.title, path: raced.workspaceRoot } };
    }
    const saved = await findExisting();
    if (!saved || saved.kind !== "project")
      throw new Error("The remote project was not saved. Try adding the folder again.");
    return { project: { id: saved.id, name: saved.title, path: saved.workspaceRoot } };
  });
}
