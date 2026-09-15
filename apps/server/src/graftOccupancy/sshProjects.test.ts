import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandId, ProjectId, type OrchestrationReadModel } from "@synara/contracts";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";

import { addSshProject } from "./sshProjects";
import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const input = (path: string) => ({
  path,
  commandId: CommandId.makeUnsafe("ssh-add-command"),
  projectId: ProjectId.makeUnsafe("ssh-add-project"),
});
function engine() {
  let model = { projects: [] } as unknown as OrchestrationReadModel;
  const dispatch = vi.fn<OrchestrationEngineShape["dispatch"]>((command) =>
    Effect.sync(() => {
      if (command.type !== "project.create") throw new Error("Unexpected command");
      model = {
        ...model,
        projects: [
          ...model.projects,
          {
            id: command.projectId,
            title: command.title,
            workspaceRoot: command.workspaceRoot,
            kind: "project",
            deletedAt: null,
          } as OrchestrationReadModel["projects"][number],
        ],
      };
      return { sequence: 1 };
    }),
  );
  return { dispatch, getReadModel: () => Effect.succeed(model) };
}

it("adds an existing folder through orchestration and recovers the same project through a symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "ssh-project-"));
  roots.push(root);
  const folder = join(root, "workspace");
  await mkdir(folder);
  await symlink(folder, join(root, "alias"));
  const runtime = engine();
  const result = await addSshProject(input(folder), runtime);
  const repeated = await addSshProject(
    { ...input(join(root, "alias")), projectId: ProjectId.makeUnsafe("other-id") },
    runtime,
  );
  expect(repeated).toEqual(result);
  expect(result.project.name).toBe("workspace");
  expect(result.project.path.endsWith("/workspace")).toBe(true);
  expect(runtime.dispatch).toHaveBeenCalledOnce();
});

it("rejects relative, missing, and file paths before dispatching", async () => {
  const root = await mkdtemp(join(tmpdir(), "ssh-project-"));
  roots.push(root);
  await writeFile(join(root, "file"), "test");
  const runtime = engine();
  await expect(addSshProject(input("relative"), runtime)).rejects.toThrow("absolute folder");
  await expect(addSshProject(input(join(root, "missing")), runtime)).rejects.toThrow();
  await expect(addSshProject(input(join(root, "file")), runtime)).rejects.toThrow("not a folder");
  expect(runtime.dispatch).not.toHaveBeenCalled();
});
