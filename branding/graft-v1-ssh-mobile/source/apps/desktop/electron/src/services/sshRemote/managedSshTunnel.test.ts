import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { ManagedSshTunnel, type TunnelProcess } from "./managedSshTunnel.js";

class FakeTunnelProcess extends EventEmitter implements TunnelProcess {
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.exitCode = 0;
    this.emit("exit", 0, signal ?? null);
    return true;
  }

  disconnectUnexpectedly(): void {
    this.exitCode = 255;
    this.emit("exit", 255, null);
  }
}

describe("ManagedSshTunnel", () => {
  it("uses loopback forwarding and reconnects with the same local route", async () => {
    const processes: FakeTunnelProcess[] = [];
    const spawnProcess = vi.fn(
      (_executable: string, _arguments: readonly string[]): TunnelProcess => {
        const process = new FakeTunnelProcess();
        processes.push(process);
        return process;
      },
    );
    const states: string[] = [];
    const tunnel = new ManagedSshTunnel({
      target: "fedora",
      remotePort: 47_831,
      expectedEnvironmentId: "host-fedora-workstation-01",
      reservePort: async () => 49_152,
      spawnProcess,
      reconnectDelaysMs: [0],
      healthProbe: async () => ({
        service: "graft-host",
        protocolVersion: 1,
        daemonVersion: "0.1.0",
        environmentId: "host-fedora-workstation-01",
        environmentLabel: "Fedora",
        platform: { os: "linux", arch: "x64", libc: "glibc" },
        port: 47_831,
        capabilities: [],
        cursor: 0,
        replayFloor: 0,
        activeRunCount: 0,
        activePtyCount: 0,
      }),
    });
    tunnel.onState((state) => states.push(state));
    await expect(tunnel.start()).resolves.toBe(49_152);
    expect(spawnProcess.mock.calls[0]?.[1]).toContain(
      "127.0.0.1:49152:127.0.0.1:47831",
    );
    processes[0]?.disconnectUnexpectedly();
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(tunnel.state).toBe("connected"));
    expect(states).toEqual([
      "connecting",
      "connected",
      "reconnecting",
      "connected",
    ]);
    await tunnel.close();
    expect(tunnel.state).toBe("closed");
  });
});
