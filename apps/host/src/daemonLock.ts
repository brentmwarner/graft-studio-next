import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { readDaemonState, removeDaemonState } from "./daemonState";

export interface DaemonProcessControl {
  isAlive(pid: number): boolean;
  signal(pid: number, signal: NodeJS.Signals): void;
}

export const defaultDaemonProcessControl: DaemonProcessControl = {
  isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  signal(pid, signal) {
    process.kill(pid, signal);
  },
};

export function isDaemonPidAlive(pid: number): boolean {
  return defaultDaemonProcessControl.isAlive(pid);
}

export function readLockPid(lockPath: string): number | null {
  try {
    const pid = Number(readFileSync(lockPath, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function tryAcquireDaemonLock(
  lockPath: string,
  pid: number,
  control: DaemonProcessControl = defaultDaemonProcessControl,
): boolean {
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lockPath, `${pid}\n`, { flag: "wx", encoding: "utf8", mode: 0o600 });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = readLockPid(lockPath);
      if (existing === pid) return true;
      if (existing !== null && control.isAlive(existing)) return false;
      rmSync(lockPath, { force: true });
    }
  }
  return false;
}

export function releaseDaemonLock(lockPath: string, pid: number): void {
  if (readLockPid(lockPath) !== pid) return;
  rmSync(lockPath, { force: true });
}

export function isStopTargetAlive(
  pid: number,
  processGroup: boolean,
  control: DaemonProcessControl,
): boolean {
  if (processGroup) return control.isAlive(-pid) || control.isAlive(pid);
  return control.isAlive(pid);
}

export async function stopDaemonPid(
  pid: number,
  options: {
    control?: DaemonProcessControl;
    wait?: (ms: number) => Promise<void>;
    timeoutMs?: number;
    killWaitMs?: number;
    processGroup?: boolean;
  } = {},
): Promise<void> {
  const control = options.control ?? defaultDaemonProcessControl;
  const wait = options.wait ?? ((ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms)));
  const timeoutMs = options.timeoutMs ?? 5_000;
  const killWaitMs = options.killWaitMs ?? 2_000;
  const processGroup = options.processGroup === true;
  const signalTarget = processGroup ? -pid : pid;
  if (!isStopTargetAlive(pid, processGroup, control)) return;
  try {
    control.signal(signalTarget, "SIGTERM");
  } catch {
    try {
      control.signal(pid, "SIGTERM");
    } catch {
      return;
    }
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isStopTargetAlive(pid, processGroup, control)) return;
    await wait(50);
  }
  try {
    control.signal(signalTarget, "SIGKILL");
  } catch {
    try {
      control.signal(pid, "SIGKILL");
    } catch {
      // The process exited between the last liveness check and SIGKILL.
    }
  }
  const killDeadline = Date.now() + killWaitMs;
  while (Date.now() < killDeadline) {
    if (!isStopTargetAlive(pid, processGroup, control)) return;
    await wait(50);
  }
  if (isStopTargetAlive(pid, processGroup, control)) {
    throw new Error(`graft-host pid ${pid} did not exit after SIGKILL`);
  }
}

export async function stopRecordedDaemon(
  statePath: string,
  options: {
    control?: DaemonProcessControl;
    wait?: (ms: number) => Promise<void>;
    timeoutMs?: number;
    killWaitMs?: number;
    processGroup?: boolean;
  } = {},
): Promise<void> {
  const state = readDaemonState(statePath);
  if (!state) return;
  const control = options.control ?? defaultDaemonProcessControl;
  if (control.isAlive(state.pid)) {
    await stopDaemonPid(state.pid, options);
  }
  removeDaemonState(statePath, state.pid);
}
