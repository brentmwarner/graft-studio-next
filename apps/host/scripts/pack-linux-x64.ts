import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const hostRoot = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(hostRoot, "dist");
const stagingDir = join(distDir, "linux-x64");
const archivePath = join(distDir, "graft-host-linux-x64.tar.gz");

mkdirSync(join(stagingDir, "bin"), { recursive: true });

const bundled = spawnSync(
  "bun",
  [
    "build",
    join(hostRoot, "src/cli.ts"),
    "--outfile",
    join(stagingDir, "bin/graft-host.mjs"),
    "--target",
    "node",
  ],
  {
    encoding: "utf8",
  },
);
if (bundled.status !== 0) {
  process.stderr.write(bundled.stderr || bundled.stdout || "bun build failed\n");
  process.exit(bundled.status ?? 1);
}

const packed = spawnSync("tar", ["-czf", archivePath, "-C", stagingDir, "bin"], {
  encoding: "utf8",
});
if (packed.status !== 0) {
  process.stderr.write(packed.stderr || packed.stdout || "tar failed\n");
  process.exit(packed.status ?? 1);
}

const digest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
writeFileSync(
  `${archivePath}.sha256`,
  `${digest}  ${dirname(archivePath) === distDir ? "graft-host-linux-x64.tar.gz" : archivePath}\n`,
);
process.stdout.write(`${archivePath}\n${digest}\n`);
