import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { syncDirectoryEntry } from "@graft/shared/filesystemPlatform";

export const LEGACY_GRAFT_LIMITS = {
  databaseBytes: 8 * 1024 ** 3,
  rows: 1_000_000,
  cellBytes: 4 * 1024 ** 2,
  planBytes: 128 * 1024 ** 2,
  exportBytes: 512 * 1024 ** 2,
  attachmentBytes: 256 * 1024 ** 2,
  totalAttachmentBytes: 2 * 1024 ** 3,
} as const;

export function stableLegacyId(sourceId: string, kind: string, originalId: string): string {
  return `legacy-graft:${kind}:${createHash("sha256").update(`${sourceId}\0${kind}\0${originalId}`).digest("hex")}`;
}

export async function privateDirectory(directory: string): Promise<string> {
  if (!path.isAbsolute(directory)) throw new Error("Migration paths must be absolute.");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Migration directory is unsafe.");
  if (process.platform !== "win32") await fs.chmod(directory, 0o700);
  return fs.realpath(directory);
}

export async function openRegularFile(filePath: string, maxBytes: number) {
  const before = await fs.lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) {
    throw new Error("Migration input is not a regular file within the size limit.");
  }
  const handle = await fs.open(
    filePath,
    constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
  );
  const after = await handle.stat();
  if (
    !after.isFile() ||
    after.size > maxBytes ||
    before.dev !== after.dev ||
    before.ino !== after.ino
  ) {
    await handle.close();
    throw new Error("Migration input changed while opening.");
  }
  return handle;
}

export async function readJson(
  filePath: string,
  maxBytes = LEGACY_GRAFT_LIMITS.planBytes,
): Promise<unknown> {
  const handle = await openRegularFile(filePath, maxBytes);
  try {
    const data = await handle.readFile("utf8");
    if (Buffer.byteLength(data) > maxBytes)
      throw new Error("Migration metadata exceeds its limit.");
    return JSON.parse(data);
  } finally {
    await handle.close();
  }
}

export async function atomicJson(filePath: string, value: unknown): Promise<void> {
  const text = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(text) > LEGACY_GRAFT_LIMITS.planBytes)
    throw new Error("Migration plan exceeds its size limit.");
  const temporary = `${filePath}.${randomUUID()}.partial`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(text);
    await handle.sync();
    await handle.close();
    await fs.rename(temporary, filePath);
    await syncDirectoryEntry(path.dirname(filePath));
  } finally {
    await handle.close().catch(() => undefined);
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function digestFile(filePath: string): Promise<string> {
  const handle = await openRegularFile(filePath, LEGACY_GRAFT_LIMITS.databaseBytes);
  const hash = createHash("sha256");
  try {
    for await (const chunk of createReadStream(filePath, { fd: handle.fd, autoClose: false })) {
      hash.update(chunk);
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

export function safeArchivePath(directory: string, relative: string): string {
  if (!/^(?:threads|attachments)\/[a-f0-9]{64}\.(?:jsonl|bin)$/.test(relative)) {
    throw new Error("Invalid legacy archive reference.");
  }
  return path.join(directory, relative);
}

export async function protectArchiveFile(filePath: string): Promise<void> {
  const handle = await fs.open(filePath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.chmod(filePath, 0o400);
}
