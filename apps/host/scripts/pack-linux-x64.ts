import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  GRAFT_HOST_BIN,
  GRAFT_HOST_LINUX_X64_ARCHIVE,
  GRAFT_HOST_SERVER_ENTRY,
} from "@graft/desktop-contract";

import { assembleGraftHostLinuxArchive, graftHostArchiveRuntimePath } from "../src/packLinuxX64.ts";
import { rewriteNodeIncompatibleImports } from "../src/nodeBundleCompat.ts";

const hostRoot = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(hostRoot, "dist");
const stagingDir = join(distDir, "linux-x64");
const archivePath = join(distDir, GRAFT_HOST_LINUX_X64_ARCHIVE);
const runtimeCopyPath = graftHostArchiveRuntimePath(join(hostRoot, "../server/dist"));

mkdirSync(join(stagingDir, "bin"), { recursive: true });

function bundle(entry: string, outfile: string): void {
  const bundled = spawnSync("bun", ["build", entry, "--outfile", outfile, "--target", "node"], {
    encoding: "utf8",
  });
  if (bundled.status !== 0) {
    process.stderr.write(bundled.stderr || bundled.stdout || `bun build failed for ${entry}\n`);
    process.exit(bundled.status ?? 1);
  }
  const contents = readFileSync(outfile, "utf8");
  const rewritten = rewriteNodeIncompatibleImports(contents);
  const withShebang = rewritten.startsWith("#!") ? rewritten : `#!/usr/bin/env node\n${rewritten}`;
  writeFileSync(outfile, withShebang);
}

bundle(join(hostRoot, "src/cli.ts"), join(stagingDir, "bin", GRAFT_HOST_BIN));
bundle(join(hostRoot, "../server/src/index.ts"), join(stagingDir, "bin", GRAFT_HOST_SERVER_ENTRY));

const serverRequire = createRequire(join(hostRoot, "../server/src/index.ts"));
const xtermPackage = serverRequire.resolve("@xterm/headless/package.json");
const xtermDestination = join(stagingDir, "bin/node_modules/@xterm/headless");
mkdirSync(dirname(xtermDestination), { recursive: true });
cpSync(dirname(xtermPackage), xtermDestination, { recursive: true });

const assembled = assembleGraftHostLinuxArchive({
  stagingDir,
  archivePath,
  runtimeCopyPath,
});
process.stdout.write(`${assembled.archivePath}\n${assembled.sha256}\n`);
