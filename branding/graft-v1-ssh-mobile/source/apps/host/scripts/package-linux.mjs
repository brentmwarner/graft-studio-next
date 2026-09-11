import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const hostRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(
  readFileSync(join(hostRoot, "package.json"), "utf8"),
);
const runtimeRoot = join(hostRoot, "runtime");
const runtimePackage = JSON.parse(
  readFileSync(join(runtimeRoot, "package.json"), "utf8"),
);
const nodeVersion = "22.22.0";
const runtimeImage =
  "node:22.22.0-bookworm@sha256:2e3d655fd1e3ffaa6b5f23ee9f3905a0fd9e8c0a65df94c8ae6e4d18a0f48870";
const stageRoot = join(hostRoot, "dist", "linux-x64-glibc");
const artifactPath = join(
  hostRoot,
  "dist",
  "graft-host-linux-x64-glibc.tar.gz",
);

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(join(stageRoot, "bin"), { recursive: true });
cpSync(
  join(hostRoot, "dist", "graft-host.mjs"),
  join(stageRoot, "bin", "graft-host.mjs"),
);
writeFileSync(
  join(stageRoot, "bin", "graft-host"),
  `#!/bin/sh
set -eu
runtime_dir="$(dirname "$(readlink -f "$0")")"
exec "$runtime_dir/node" "$runtime_dir/graft-host.mjs" "$@"
`,
  { encoding: "utf8", mode: 0o755 },
);

for (const dependency of ["better-sqlite3", "node-pty", "ws"]) {
  if (
    packageJson.dependencies[dependency] !==
    runtimePackage.dependencies[dependency]
  ) {
    throw new Error(
      `Host dependency ${dependency} must match the pinned Linux runtime`,
    );
  }
}

const built = spawnSync(
  "docker",
  [
    "buildx",
    "build",
    "--platform",
    "linux/amd64",
    "--output",
    `type=local,dest=${stageRoot}`,
    runtimeRoot,
  ],
  { stdio: "inherit" },
);
if (built.status !== 0) {
  throw new Error("Failed to build the pinned Linux host runtime");
}

for (const dependency of ["better-sqlite3", "node-pty", "ws"]) {
  const installedPackage = JSON.parse(
    readFileSync(
      join(stageRoot, "node_modules", dependency, "package.json"),
      "utf8",
    ),
  );
  if (installedPackage.version !== runtimePackage.dependencies[dependency]) {
    throw new Error(`Bundled ${dependency} version does not match its lock`);
  }
}

function containsFileNamed(root, name) {
  if (!existsSync(root)) return false;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === name && statSync(path).size > 0) {
      return true;
    }
    if (entry.isDirectory() && containsFileNamed(path, name)) return true;
  }
  return false;
}

if (
  !containsFileNamed(
    join(stageRoot, "node_modules", "better-sqlite3"),
    "better_sqlite3.node",
  )
) {
  throw new Error("The Linux better-sqlite3 native module is missing");
}
if (
  !containsFileNamed(join(stageRoot, "node_modules", "node-pty"), "pty.node")
) {
  throw new Error("The Linux node-pty native runtime is incomplete");
}

const verified = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--platform",
    "linux/amd64",
    "--volume",
    `${stageRoot}:/runtime:ro`,
    "--workdir",
    "/runtime",
    runtimeImage,
    "/runtime/bin/node",
    "-e",
    'const Database = require("better-sqlite3"); new Database(":memory:").close(); require("ws"); const pty = require("node-pty"); let output = ""; const child = pty.spawn("/bin/sh", ["-lc", "printf graft-pty-ok"]); child.onData((data) => { output += data; }); child.onExit(({ exitCode }) => { if (exitCode !== 0 || !output.includes("graft-pty-ok")) process.exit(1); });',
  ],
  { stdio: "inherit" },
);
if (verified.status !== 0) {
  throw new Error(
    "The bundled Linux host runtime failed its native smoke test",
  );
}

const launcherVerified = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--platform",
    "linux/amd64",
    "--volume",
    `${stageRoot}:/runtime:ro`,
    "--workdir",
    "/runtime",
    runtimeImage,
    "/runtime/bin/graft-host",
    "version",
  ],
  { encoding: "utf8" },
);
if (launcherVerified.error) throw launcherVerified.error;
if (
  launcherVerified.status !== 0 ||
  launcherVerified.stdout.trim() !== packageJson.version
) {
  if (launcherVerified.stderr) process.stderr.write(launcherVerified.stderr);
  throw new Error("The bundled Linux host launcher failed its smoke test");
}

writeFileSync(
  join(stageRoot, "package.json"),
  `${JSON.stringify(
    {
      name: "@graft/host-linux-x64-glibc",
      version: packageJson.version,
      private: true,
      type: "module",
      bin: { "graft-host": "bin/graft-host" },
      dependencies: runtimePackage.dependencies,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
writeFileSync(
  join(stageRoot, "manifest.json"),
  `${JSON.stringify(
    {
      service: "graft-host",
      version: packageJson.version,
      protocolVersion: 1,
      target: { os: "linux", arch: "x64", libc: "glibc" },
      entrypoint: "bin/graft-host",
      install: "self-contained",
      runtime: {
        name: "node",
        version: nodeVersion,
        entrypoint: "bin/node",
      },
      runtimeImage,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const archiveName = artifactPath.slice(dirname(artifactPath).length + 1);

// The archive is written to a scratch directory outside `dist/` and copied into
// place afterwards. Mounting `dist/` as the output directory puts a writable
// mount on the stage directory's own parent, and on Docker Desktop for macOS
// writing the tarball there perturbs the read-only stage mount mid-read: tar
// reports `.: file changed as we read it` and exits 1.
rmSync(artifactPath, { force: true });
const archiveScratchRoot = mkdtempSync(join(tmpdir(), "graft-host-archive-"));
const scratchArchivePath = join(archiveScratchRoot, archiveName);
const dockerArchiveArgs = [
  "run",
  "--rm",
  "--platform",
  "linux/amd64",
  "--volume",
  `${stageRoot}:/stage:ro`,
  "--volume",
  `${archiveScratchRoot}:/out`,
  runtimeImage,
  "tar",
  "--sort=name",
  "--mtime=UTC 1970-01-01",
  "--owner=0",
  "--group=0",
  "--numeric-owner",
  "--pax-option=delete=atime,delete=ctime",
  "-czf",
  `/out/${archiveName}`,
  "-C",
  "/stage",
  ".",
];

// GNU tar's determinism flags are not portable. macOS ships bsdtar, which
// rejects `--sort`/`--mtime`/`--owner=`/`--group=` outright, so the host
// fallback has to pick its arguments from the tar it actually found. That
// fallback archive is not byte-reproducible, which is acceptable: the released
// artifact is always the Docker-built one, and the fallback only backs local
// verification when Docker is unavailable.
function resolveHostTar() {
  for (const command of ["gtar", "tar"]) {
    const probe = spawnSync(command, ["--version"], { encoding: "utf8" });
    if (probe.status !== 0) continue;
    return { command, gnu: /GNU tar/.test(probe.stdout ?? "") };
  }
  return null;
}

function hostArchiveArgs(hostTar) {
  const determinism = hostTar.gnu
    ? [
        "--sort=name",
        "--mtime=UTC 1970-01-01",
        "--owner=0",
        "--group=0",
        "--numeric-owner",
      ]
    : ["--uid", "0", "--gid", "0", "--numeric-owner"];
  return [...determinism, "-czf", artifactPath, "-C", stageRoot, "."];
}

function relativeStagePaths(root, prefix = "") {
  const paths = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const relativePath = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      paths.push(...relativeStagePaths(join(root, entry.name), `${relativePath}/`));
    } else {
      paths.push(relativePath);
    }
  }
  return paths;
}

// GNU tar exits 1 for warnings as well as errors, so its status alone cannot
// decide whether the archive is usable. Nor can a spot check: tar writes
// entries in sorted order, so an archive truncated partway through still
// contains `manifest.json` while missing the native modules underneath
// `node_modules/`. The archive is accepted only when it lists every file that
// was staged.
function archiveContainsStage(path) {
  if (!existsSync(path) || statSync(path).size === 0) return false;
  const hostTar = resolveHostTar();
  if (!hostTar) return false;
  const listed = spawnSync(hostTar.command, ["-tzf", path], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.status !== 0) return false;
  const archived = new Set(
    listed.stdout
      .split("\n")
      .map((entry) => entry.replace(/^\.\//, "").replace(/\/$/, ""))
      .filter(Boolean),
  );
  return relativeStagePaths(stageRoot).every((staged) => archived.has(staged));
}

try {
  spawnSync("docker", dockerArchiveArgs, { stdio: "inherit" });
  if (archiveContainsStage(scratchArchivePath)) {
    copyFileSync(scratchArchivePath, artifactPath);
  } else {
    const hostTar = resolveHostTar();
    if (hostTar) {
      spawnSync(hostTar.command, hostArchiveArgs(hostTar), { stdio: "inherit" });
    }
    if (!archiveContainsStage(artifactPath)) {
      rmSync(artifactPath, { force: true });
      throw new Error("Failed to create Linux host archive");
    }
  }
} finally {
  rmSync(archiveScratchRoot, { recursive: true, force: true });
}
process.stdout.write(`${artifactPath}\n`);
