import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export interface GraftHostDaemonState {
  pid: number;
  port: number;
  version: string;
  startedAt: number;
}

function isDaemonState(value: unknown): value is GraftHostDaemonState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<GraftHostDaemonState>;
  return (
    Number.isInteger(state.pid) &&
    (state.pid ?? 0) > 0 &&
    Number.isInteger(state.port) &&
    (state.port ?? 0) > 0 &&
    (state.port ?? 0) <= 65_535 &&
    typeof state.version === "string" &&
    state.version.length > 0 &&
    Number.isInteger(state.startedAt) &&
    (state.startedAt ?? -1) >= 0
  );
}

export function readDaemonState(path: string): GraftHostDaemonState | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isDaemonState(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeDaemonState(path: string, state: GraftHostDaemonState): void {
  if (!isDaemonState(state)) throw new Error("Invalid graft-host daemon state");
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(state)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function removeDaemonState(path: string, expectedPid: number): void {
  const current = readDaemonState(path);
  if (current?.pid !== expectedPid) return;
  rmSync(path, { force: true });
}
