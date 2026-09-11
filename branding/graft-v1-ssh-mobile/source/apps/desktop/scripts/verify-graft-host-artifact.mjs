#!/usr/bin/env node

import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const archivePath = resolve(
  process.argv[2] ??
    join(scriptDirectory, "../../host/dist/graft-host-linux-x64-glibc.tar.gz"),
);

if (!existsSync(archivePath) || statSync(archivePath).size === 0) {
  throw new Error(
    `Self-contained graft-host artifact is missing: ${archivePath}`,
  );
}

const listed = spawnSync("tar", ["-tzf", archivePath], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
if (listed.error) throw listed.error;
if (listed.status !== 0) {
  throw new Error(
    `Could not inspect graft-host artifact: ${listed.stderr.trim()}`,
  );
}

const archiveEntries = listed.stdout
  .split("\n")
  .map((entry) => entry.replace(/^\.\//u, ""))
  .filter(Boolean);
const entries = new Set(archiveEntries);
for (const required of [
  "bin/node",
  "bin/graft-host",
  "bin/graft-host.mjs",
  "licenses/node/LICENSE",
  "manifest.json",
]) {
  if (!entries.has(required)) {
    throw new Error(
      `Self-contained graft-host artifact is missing ${required}`,
    );
  }
}
for (const nativeModule of ["better_sqlite3.node", "pty.node"]) {
  if (!archiveEntries.some((entry) => entry.endsWith(`/${nativeModule}`))) {
    throw new Error(
      `Self-contained graft-host artifact is missing ${nativeModule}`,
    );
  }
}

const manifestEntry = listed.stdout
  .split("\n")
  .find((entry) => entry.replace(/^\.\//u, "") === "manifest.json");
const extracted = spawnSync("tar", ["-xOzf", archivePath, manifestEntry], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
});
if (extracted.error) throw extracted.error;
if (extracted.status !== 0) {
  throw new Error(
    `Could not read graft-host artifact manifest: ${extracted.stderr.trim()}`,
  );
}

const manifest = JSON.parse(extracted.stdout);
if (
  manifest?.target?.os !== "linux" ||
  manifest?.target?.arch !== "x64" ||
  manifest?.target?.libc !== "glibc" ||
  manifest?.entrypoint !== "bin/graft-host" ||
  manifest?.runtime?.name !== "node" ||
  manifest?.runtime?.version !== "22.22.0" ||
  manifest?.runtime?.entrypoint !== "bin/node"
) {
  throw new Error("graft-host artifact manifest is not the supported runtime");
}

process.stdout.write(
  `[desktop] Verified self-contained graft-host: ${archivePath}\n`,
);
