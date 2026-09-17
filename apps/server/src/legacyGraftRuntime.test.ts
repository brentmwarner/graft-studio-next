import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLegacyFixture } from "./legacyGraft/fixtures";
import { LegacyGraftRuntime } from "./legacyGraftRuntime";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function paths() {
  const root = await mkdtemp(join(tmpdir(), "graft-import-startup-"));
  directories.push(root);
  const sourceProfile = join(root, "legacy");
  await mkdir(sourceProfile);
  return { sourceProfile, directory: join(root, "new", "legacy-graft-import") };
}

describe("legacy Graft startup", () => {
  it("does not create an import for a fresh installation", async () => {
    const options = await paths();
    const runtime = new LegacyGraftRuntime(options);
    const dispatch = vi.fn();
    await runtime.start(dispatch);
    expect(await runtime.getStatus()).toEqual({ phase: "no-source", progress: null, error: null });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("keeps a corrupt legacy database intact and reports failure before dispatch", async () => {
    const options = await paths();
    await writeFile(join(options.sourceProfile, "graft-local.db"), "not a database");
    const runtime = new LegacyGraftRuntime(options);
    const dispatch = vi.fn();
    await runtime.start(dispatch);
    expect((await runtime.getStatus()).phase).toBe("failed");
    expect(dispatch).not.toHaveBeenCalled();
    expect(await readFile(join(options.sourceProfile, "graft-local.db"), "utf8")).toBe(
      "not a database",
    );
  });

  it("serializes startup, records read-only admission before create, and resumes from its archive after source removal", async () => {
    const options = await paths();
    const fixture = createLegacyFixture(options.sourceProfile);
    fixture.database.close();
    const runtime = new LegacyGraftRuntime(options);
    const dispatch = vi.fn(async (command) => {
      if (command.type === "thread.create") {
        const registry = JSON.parse(
          await readFile(join(options.directory, "read-only-threads.json"), "utf8"),
        );
        expect(registry.threadIds).toContain(command.threadId);
      }
    });
    await Promise.all([runtime.start(dispatch), runtime.start(dispatch)]);
    expect((await runtime.getStatus()).phase).toBe("complete");
    const count = dispatch.mock.calls.length;
    await rm(options.sourceProfile, { recursive: true });
    const restarted = new LegacyGraftRuntime(options);
    await restarted.start(dispatch);
    expect((await restarted.getStatus()).phase).toBe("complete");
    expect(dispatch).toHaveBeenCalledTimes(count);
    expect(
      (await restarted.readThread("thread", 0)).records.some(
        (record) => record.table === "run_events",
      ),
    ).toBe(true);
  });
});
