#!/usr/bin/env node
// Exercises the actual Linux package against disposable legacy data. This is
// startup/import evidence; it does not claim a real WorkOS or updater install.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright";

import { createLegacyFixture } from "../../server/src/legacyGraft/fixtures.ts";
import { createPackagedDesktopSmokeEnvironment } from "../../../scripts/verify-packaged-desktop-startup.ts";

if (process.platform !== "linux" || !process.argv[2]) {
  throw new Error(
    "Usage on Linux: node apps/web/scripts/smoke-graft-production.mjs <Graft.AppImage>",
  );
}
const artifact = resolve(process.argv[2]);
const output = fileURLToPath(
  new URL("../../../.tmp/production-rollout/packaged-smoke/", import.meta.url),
);
mkdirSync(output, { recursive: true });
const temporaryRoot = mkdtempSync(join(tmpdir(), "graft-production-smoke-"));
const legacyProfile = join(temporaryRoot, "legacy-profile");
mkdirSync(legacyProfile);
const legacy = createLegacyFixture(legacyProfile);
const projectDirectory = join(temporaryRoot, "project");
mkdirSync(projectDirectory);
execFileSync("git", ["init", "--quiet", projectDirectory]);
legacy.database.prepare("UPDATE projects SET repoPath = ?").run(projectDirectory);
legacy.database
  .prepare("UPDATE threads SET mode = 'local', worktreeId = NULL, localPath = ?")
  .run(projectDirectory);
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const sourceDigest = digest(legacy.databasePath);
const sourceWalDigest = digest(`${legacy.databasePath}-wal`);
const env = createPackagedDesktopSmokeEnvironment(temporaryRoot, {
  platform: "linux",
  version: "0.9.0",
});
env.GRAFT_LEGACY_USER_DATA = legacyProfile;
env.GRAFT_AUTO_BOOTSTRAP_PROJECT_FROM_CWD = "0";
// A packaged launch must not inherit a development renderer or state directory.
env.VITE_DEV_SERVER_URL = "http://127.0.0.1:1";
const errors = [];
let desktop;
let page;

async function ownerJson(path) {
  const ws = new URL(await page.evaluate(() => window.desktopBridge.getWsUrl()));
  const url = new URL(path, `http://${ws.host}`);
  url.searchParams.set("token", ws.searchParams.get("token"));
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Local owner route failed (${response.status}).`);
  return response.json();
}

async function launch() {
  desktop = await electron.launch({
    executablePath: join(temporaryRoot, "squashfs-root", "graft"),
    args: ["--no-sandbox"],
    env,
    timeout: 60_000,
  });
  desktop.process().stderr.on("data", (chunk) => errors.push(chunk.toString()));
  const identity = await desktop.evaluate(({ app }) => ({
    name: app.getName(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    userData: app.getPath("userData"),
  }));
  assert.equal(identity.name, "Graft");
  assert.equal(identity.version, "0.9.0");
  assert.equal(identity.packaged, true);
  assert.ok(identity.userData.startsWith(temporaryRoot));
  page = await desktop.firstWindow({ timeout: 60_000 });
  await page.waitForURL("graft://app/index.html*", { timeout: 60_000 });
  await page.getByRole("heading", { name: "Welcome to Graft" }).waitFor({ timeout: 60_000 });
  await page
    .getByRole("button", { name: "Sign in to Graft", exact: true })
    .waitFor({ timeout: 60_000 });
  const account = await page.evaluate(() => window.desktopBridge.account.getState());
  assert.equal(account.status, "signed-out");
  const deadline = Date.now() + 90_000;
  let status;
  while (Date.now() < deadline) {
    status = await ownerJson("/api/graft/legacy/status").catch(() => null);
    if (status?.phase === "complete" || status?.phase === "failed") break;
    await new Promise((done) => setTimeout(done, 250));
  }
  assert.equal(status?.phase, "complete", status?.error ?? "Import never became ready");
  assert.equal(status.progress.summary.importedThreads, 1);
  assert.equal(status.progress.summary.archiveOnlyThreads, 1);
  assert.equal(status.progress.summary.resumedThreads, 0);
  const archive = await ownerJson("/api/graft/legacy/thread?id=thread");
  assert.ok(archive.records.some((record) => record.table === "run_events"));
  assert.ok(
    archive.records.some(
      (record) => record.table === "message_parts" && record.row.content === "Original response",
    ),
  );
  assert.equal(digest(legacy.databasePath), sourceDigest);
  assert.equal(digest(`${legacy.databasePath}-wal`), sourceWalDigest);
  assert.ok(existsSync(join(env.GRAFT_HOME, "userdata", "state.sqlite")));
  assert.equal(existsSync(join(env.GRAFT_HOME, "dev", "state.sqlite")), false);
  return status;
}

try {
  execFileSync(artifact, ["--appimage-extract"], { cwd: temporaryRoot, stdio: "ignore" });
  const first = await launch();
  await page.evaluate(() => localStorage.setItem("graft-production-smoke", "preserved"));
  await desktop.close();
  desktop = undefined;
  const second = await launch();
  assert.deepEqual(second.progress, first.progress);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("graft-production-smoke")),
    "preserved",
  );
  await page.screenshot({ path: join(output, "account-gate.png") });
  writeFileSync(
    join(output, "result.json"),
    JSON.stringify(
      {
        version: "0.9.0",
        artifactSha256: digest(artifact),
        packagedIdentity: "Graft",
        renderer: "graft://app",
        isolatedProfile: true,
        legacySourcePreserved: true,
        walPreserved: true,
        importedThreads: second.progress.summary.importedThreads,
        archivedOnlyThreads: second.progress.summary.archiveOnlyThreads,
        duplicateImportAfterRestart: false,
        signInGate: "passed",
        realWorkOSLogin: "not-run",
        legacyUpdaterInstall: "not-run",
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: packaged identity, required sign-in, legacy database/WAL preservation, archive, import restart, state isolation.",
  );
} catch (error) {
  if (page && !page.isClosed())
    await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  writeFileSync(join(output, "failure.log"), errors.join(""));
  throw error;
} finally {
  if (desktop) await desktop.close();
  legacy.database.close();
  rmSync(temporaryRoot, { recursive: true, force: true });
}
