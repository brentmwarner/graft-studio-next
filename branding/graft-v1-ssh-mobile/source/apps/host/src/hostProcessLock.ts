import { randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

interface LockRecord {
  pid: number;
  nonce: string;
  acquiredAt: number;
}

function readRecord(path: string): LockRecord | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<LockRecord>;
    if (
      typeof value.pid !== "number" ||
      !Number.isInteger(value.pid) ||
      value.pid <= 0 ||
      typeof value.nonce !== "string" ||
      typeof value.acquiredAt !== "number"
    ) {
      return null;
    }
    return value as LockRecord;
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class HostProcessLock {
  private released = false;

  private constructor(
    private readonly path: string,
    private readonly record: LockRecord,
  ) {}

  static acquire(path: string): HostProcessLock {
    mkdirSync(dirname(path), { recursive: true });
    const record: LockRecord = {
      pid: process.pid,
      nonce: randomUUID(),
      acquiredAt: Date.now(),
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = openSync(path, "wx", 0o600);
        try {
          writeFileSync(fd, `${JSON.stringify(record)}\n`, "utf8");
        } finally {
          closeSync(fd);
        }
        return new HostProcessLock(path, record);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;
        const owner = readRecord(path);
        if (owner && processIsAlive(owner.pid)) {
          throw new Error(
            `graft-host is already running with pid ${owner.pid}`,
          );
        }
        try {
          unlinkSync(path);
        } catch (unlinkError) {
          if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") {
            throw unlinkError;
          }
        }
      }
    }
    throw new Error("Could not acquire the graft-host daemon lock");
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    const current = readRecord(this.path);
    if (current?.nonce !== this.record.nonce) return;
    try {
      unlinkSync(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
