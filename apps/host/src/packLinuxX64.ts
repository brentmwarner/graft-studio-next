import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

import { GRAFT_HOST_LINUX_X64_ARCHIVE } from "@graft/desktop-contract";

export interface AssembleGraftHostLinuxArchiveInput {
  readonly stagingDir: string;
  readonly archivePath: string;
  readonly runtimeCopyPath?: string;
}

export interface AssembledGraftHostLinuxArchive {
  readonly archivePath: string;
  readonly sha256: string;
}

export function assembleGraftHostLinuxArchive(
  input: AssembleGraftHostLinuxArchiveInput,
): AssembledGraftHostLinuxArchive {
  const archiveDir = dirname(input.archivePath);
  mkdirSync(archiveDir, { recursive: true });
  // GNU tar treats the colon in an absolute Windows path such as D:\\... as a
  // remote archive separator. Run from the archive directory and pass only
  // relative paths so this Linux payload can be assembled on every build OS.
  const relativeStagingDir = relative(archiveDir, input.stagingDir) || ".";
  const packed = spawnSync(
    "tar",
    ["-czf", basename(input.archivePath), "-C", relativeStagingDir, "bin"],
    {
      cwd: archiveDir,
      encoding: "utf8",
    },
  );
  if (packed.status !== 0) {
    throw new Error(packed.stderr || packed.stdout || "tar failed");
  }
  const digest = createHash("sha256").update(readFileSync(input.archivePath)).digest("hex");
  writeFileSync(`${input.archivePath}.sha256`, `${digest}  ${GRAFT_HOST_LINUX_X64_ARCHIVE}\n`);
  if (input.runtimeCopyPath) {
    mkdirSync(dirname(input.runtimeCopyPath), { recursive: true });
    copyFileSync(input.archivePath, input.runtimeCopyPath);
    copyFileSync(`${input.archivePath}.sha256`, `${input.runtimeCopyPath}.sha256`);
  }
  return { archivePath: input.archivePath, sha256: digest };
}

export function graftHostArchiveRuntimePath(serverDistDir: string): string {
  return join(serverDistDir, GRAFT_HOST_LINUX_X64_ARCHIVE);
}
