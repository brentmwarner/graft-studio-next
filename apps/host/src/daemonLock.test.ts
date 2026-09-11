import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { writeDaemonState } from "./daemonState";
import {
  readLockPid,
  releaseDaemonLock,
  stopDaemonPid,
  stopRecordedDaemon,
  tryAcquireDaemonLock,
  type DaemonProcessControl,
} from "./daemonLock";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "graft-host-lock-"));
  roots.push(root);
  return root;
}

function control(alive: Set<number>, signals: NodeJS.Signals[] = []): DaemonProcessControl {
  return {
    isAlive: (pid) => alive.has(pid),
    signal: (pid, signal) => {
      signals.push(signal);
      if (signal === "SIGTERM" || signal === "SIGKILL") alive.delete(pid);
    },
  };
}

describe("graft-host daemon lock", () => {
  it("gives the second serve a live lock owner instead of a second daemon", () => {
    const lockPath = join(tempRoot(), "daemon.lock");
    expect(tryAcquireDaemonLock(lockPath, 4_001)).toBe(true);
    expect(readLockPid(lockPath)).toBe(4_001);
    expect(
      tryAcquireDaemonLock(lockPath, 4_002, {
        isAlive: (pid) => pid === 4_001,
        signal: () => undefined,
      }),
    ).toBe(false);
    releaseDaemonLock(lockPath, 4_001);
    expect(
      tryAcquireDaemonLock(lockPath, 4_002, {
        isAlive: () => false,
        signal: () => undefined,
      }),
    ).toBe(true);
  });

  it("replaces a lock whose recorded pid is already gone", () => {
    const lockPath = join(tempRoot(), "daemon.lock");
    writeFileSync(lockPath, "999999\n");
    expect(
      tryAcquireDaemonLock(lockPath, 7, {
        isAlive: () => false,
        signal: () => undefined,
      }),
    ).toBe(true);
    expect(readLockPid(lockPath)).toBe(7);
  });
});

describe("graft-host daemon upgrade", () => {
  it("SIGTERMs a live recorded pid and removes daemon.json before a new serve", async () => {
    const root = tempRoot();
    const statePath = join(root, "daemon.json");
    const alive = new Set([3_214]);
    const signals: NodeJS.Signals[] = [];
    writeDaemonState(statePath, {
      pid: 3_214,
      port: 4_783,
      version: "0.1.0",
      startedAt: 1,
    });
    await stopRecordedDaemon(statePath, {
      control: control(alive, signals),
      wait: async () => undefined,
      timeoutMs: 1_000,
    });
    expect(signals).toEqual(["SIGTERM"]);
    expect(alive.has(3_214)).toBe(false);
    expect(existsSync(statePath)).toBe(false);
  });

  it("escalates to SIGKILL when SIGTERM does not reap the old daemon", async () => {
    const pid = 8_888;
    const signals: NodeJS.Signals[] = [];
    const controlIgnoringTerm: DaemonProcessControl = {
      isAlive: (candidate) => candidate === pid,
      signal: (_candidate, signal) => {
        signals.push(signal);
        if (signal === "SIGKILL") {
          controlIgnoringTerm.isAlive = () => false;
        }
      },
    };
    await stopDaemonPid(pid, {
      control: controlIgnoringTerm,
      wait: async () => undefined,
      timeoutMs: 0,
    });
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });
});
