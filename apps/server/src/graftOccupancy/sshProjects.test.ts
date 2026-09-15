import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandId, ProjectId, type OrchestrationCommand } from "@graft/contracts";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";

import { addSshProject, SshProjectInputError } from "./sshProjects";
import { decideOrchestrationCommand } from "../orchestration/decider";
import { createEmptyReadModel, projectEvent } from "../orchestration/projector";

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
  let model = createEmptyReadModel(new Date().toISOString());
  let sequence = 0;
  const dispatch = vi.fn((command: OrchestrationCommand) =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({ command, readModel: model });
      for (const event of Array.isArray(result) ? result : [result]) {
        model = yield* projectEvent(model, { ...event, sequence: ++sequence });
      }
      return { sequence };
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

it("returns one live project for concurrent adds of the same canonical folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "ssh-project-"));
  roots.push(root);
  const folder = join(root, "workspace");
  const alias = join(root, "alias");
  await mkdir(folder);
  await symlink(folder, alias);
  const runtime = engine();
  const firstRead = Promise.withResolvers<void>();
  const releaseRead = Promise.withResolvers<void>();
  const getReadModel = runtime.getReadModel;
  runtime.getReadModel = () => {
    const snapshot = getReadModel();
    firstRead.resolve();
    return Effect.promise(() => releaseRead.promise).pipe(Effect.andThen(snapshot));
  };

  const first = addSshProject(input(folder), runtime);
  const second = addSshProject(
    {
      ...input(alias),
      commandId: CommandId.makeUnsafe("second-command"),
      projectId: ProjectId.makeUnsafe("second-project"),
    },
    runtime,
  );
  await firstRead.promise;
  // Keep the first snapshot pending while the other request resolves its real filesystem path.
  await Effect.runPromise(Effect.sleep("25 millis"));
  releaseRead.resolve();
  const [created, repeated] = await Promise.all([first, second]);

  expect(repeated).toEqual(created);
  expect(runtime.dispatch).toHaveBeenCalledOnce();
  const saved = await Effect.runPromise(getReadModel());
  expect(
    saved.projects.filter((project) => project.deletedAt === null).map(({ id }) => id),
  ).toEqual([created.project.id]);
});

it("releases the folder queue after a failed add so a retry can create the project", async () => {
  const root = await mkdtemp(join(tmpdir(), "ssh-project-"));
  roots.push(root);
  const runtime = engine();
  runtime.dispatch.mockImplementationOnce(() => Effect.die(new Error("Database unavailable")));
  await expect(addSshProject(input(root), runtime)).rejects.toThrow("Database unavailable");
  await expect(addSshProject(input(root), runtime)).resolves.toMatchObject({
    project: { id: input(root).projectId },
  });
  expect(runtime.dispatch).toHaveBeenCalledTimes(2);
});

it("rejects relative, missing, and file paths before dispatching", async () => {
  const root = await mkdtemp(join(tmpdir(), "ssh-project-"));
  roots.push(root);
  await writeFile(join(root, "file"), "test");
  const runtime = engine();
  await expect(addSshProject(input("relative"), runtime)).rejects.toThrow("absolute folder");
  await expect(addSshProject(input(join(root, "missing")), runtime)).rejects.toBeInstanceOf(
    SshProjectInputError,
  );
  await expect(addSshProject(input(join(root, "file")), runtime)).rejects.toThrow("not a folder");
  expect(runtime.dispatch).not.toHaveBeenCalled();
});
