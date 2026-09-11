import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  compareFixtureDirectories,
  runFixtureCommand,
  syncFixtureDirectories,
} from "./mobile-protocol-fixtures.mjs";

test("equal fixture directories pass", async (context) => {
  const fixture = await createFixtureDirectories(context);
  await writeJson(fixture.source, "b.json", '{"b":2}\n');
  await writeJson(fixture.source, "nested/a.json", '{"a":1}\n');
  await writeJson(fixture.target, "nested/a.json", '{"a":1}\n');
  await writeJson(fixture.target, "b.json", '{"b":2}\n');

  const output = captureOutput();
  const exitCode = await runFixtureCommand(fixture.args("--check"), output.sink);

  assert.equal(exitCode, 0);
  assert.deepEqual(output.errors, []);
  assert.deepEqual(output.logs, ["iOS protocol fixtures are in sync (2 files)."]);
});

test("check reports missing fixtures in sorted order", async (context) => {
  const fixture = await createFixtureDirectories(context);
  await writeJson(fixture.source, "z.json", "z");
  await writeJson(fixture.source, "a.json", "a");

  const output = captureOutput();
  const exitCode = await runFixtureCommand(fixture.args("--check"), output.sink);

  assert.equal(exitCode, 1);
  assert.deepEqual(output.errors.slice(1, 3), ["  missing: a.json", "  missing: z.json"]);
});

test("check reports extra fixtures", async (context) => {
  const fixture = await createFixtureDirectories(context);
  await writeJson(fixture.source, "current.json", "current");
  await writeJson(fixture.target, "current.json", "current");
  await writeJson(fixture.target, "stale.json", "stale");

  const result = await compareFixtureDirectories(fixture.source, fixture.target);

  assert.deepEqual(result.extra, ["stale.json"]);
});

test("check detects byte changes without normalizing JSON", async (context) => {
  const fixture = await createFixtureDirectories(context);
  await writeJson(fixture.source, "same-value.json", '{"ok":true}\n');
  await writeJson(fixture.target, "same-value.json", '{ "ok": true }\n');

  const result = await compareFixtureDirectories(fixture.source, fixture.target);

  assert.deepEqual(result.changed, ["same-value.json"]);
});

test("write removes stale JSON and copies exact source bytes", async (context) => {
  const fixture = await createFixtureDirectories(context);
  const expected = Buffer.from([0x7b, 0x0a, 0x20, 0x20, 0x7d, 0x0a]);
  await writeJson(fixture.source, "nested/current.json", expected);
  await writeJson(fixture.target, "stale.json", "stale");
  await writeJson(fixture.target, "notes.txt", "preserve unrelated files");

  const result = await syncFixtureDirectories(fixture.source, fixture.target);

  assert.equal(result.total, 1);
  assert.deepEqual(await readFile(join(fixture.target, "nested/current.json")), expected);
  await assert.rejects(readFile(join(fixture.target, "stale.json")), {
    code: "ENOENT",
  });
  assert.equal(
    await readFile(join(fixture.target, "notes.txt"), "utf8"),
    "preserve unrelated files",
  );
});

test("missing source fails before touching the target", async (context) => {
  const fixture = await createFixtureDirectories(context);
  const marker = join(fixture.target, "marker.json");
  await writeFile(marker, "keep");

  const output = captureOutput();
  const exitCode = await runFixtureCommand(
    ["--write", "--source", join(fixture.root, "missing"), "--target", fixture.target],
    output.sink,
  );

  assert.equal(exitCode, 1);
  assert.match(output.errors[0], /Source directory does not exist/);
  assert.equal(await readFile(marker, "utf8"), "keep");
});

test("write rejects nested source and target directories", async (context) => {
  const fixture = await createFixtureDirectories(context);
  await writeJson(fixture.source, "current.json", "current");

  await assert.rejects(
    syncFixtureDirectories(fixture.source, join(fixture.source, "ios-copy")),
    /different and non-nested/,
  );
});

test("check rejects symlinks inside fixture directories", async (context) => {
  const fixture = await createFixtureDirectories(context);
  const external = join(fixture.root, "external.json");
  await writeFile(external, "external");
  await symlink(external, join(fixture.source, "linked.json"));

  await assert.rejects(
    compareFixtureDirectories(fixture.source, fixture.target),
    /must not contain symlinks/,
  );
});

async function createFixtureDirectories(context) {
  const root = await mkdtemp(join(tmpdir(), "graft-mobile-fixtures-"));
  const source = join(root, "source");
  const target = join(root, "target");
  await Promise.all([mkdir(source, { recursive: true }), mkdir(target, { recursive: true })]);
  context.after(() => rm(root, { force: true, recursive: true }));
  return {
    args: (mode) => [mode, "--source", source, "--target", target],
    root,
    source,
    target,
  };
}

async function writeJson(root, relativePath, contents) {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

function captureOutput() {
  const errors = [];
  const logs = [];
  return {
    errors,
    logs,
    sink: {
      error: (message) => errors.push(message),
      log: (message) => logs.push(message),
    },
  };
}
