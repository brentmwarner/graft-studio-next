import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { GraftDesktopHealth } from "@graft/desktop-contract";
import { afterEach, expect, it, vi } from "vitest";

import { ManagedSshTunnel, type TunnelProcess } from "./managedSshTunnel";

class Child extends EventEmitter implements TunnelProcess {
  pid: number | undefined;
  stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;
  kill = vi.fn(() => {
    this.killed = true;
    return true;
  });
}
const health = { environmentId: "test-environment" } as GraftDesktopHealth;
const options = { target: "test", remotePort: 4000, expectedEnvironmentId: health.environmentId };

afterEach(() => vi.useRealTimers());

it("waits for the SSH process to exit before completing disconnect", async () => {
  const child = new Child();
  const tunnel = new ManagedSshTunnel({
    ...options,
    localPort: 4001,
    spawnProcess: () => child,
    healthProbe: async () => health,
  });
  await tunnel.start();
  let closed = false;
  const closing = tunnel.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  expect(closed).toBe(false);
  child.exitCode = 0;
  child.emit("exit", 0, "SIGTERM");
  await closing;
  expect(tunnel.state).toBe("closed");
});

it("does not spawn when closed during port reservation", async () => {
  const port = Promise.withResolvers<number>();
  const spawnProcess = vi.fn();
  const tunnel = new ManagedSshTunnel({
    ...options,
    reservePort: () => port.promise,
    spawnProcess,
  });
  const starting = expect(tunnel.start()).rejects.toMatchObject({ code: "connection_closed" });
  await tunnel.close();
  port.resolve(4001);
  await starting;
  expect(spawnProcess).not.toHaveBeenCalled();
});

it("does not report a running process as closed when signaling it fails", async () => {
  vi.useFakeTimers();
  const child = new Child();
  child.pid = 123;
  const tunnel = new ManagedSshTunnel({
    ...options,
    localPort: 4001,
    spawnProcess: () => child,
    healthProbe: async () => health,
  });
  await tunnel.start();
  const closing = expect(tunnel.close()).rejects.toMatchObject({
    code: "connection_closed",
    message: "The SSH process did not exit after disconnecting.",
  });
  child.emit("error", Object.assign(new Error("Kill failed"), { code: "EPERM" }));
  await vi.advanceTimersByTimeAsync(5_000);
  await closing;
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  expect(tunnel.state).not.toBe("closed");
  const retry = tunnel.close();
  child.emit("exit", 0, "SIGKILL");
  await retry;
  expect(tunnel.state).toBe("closed");
});

it("stops readiness polling after the SSH executable fails to start", async () => {
  vi.useFakeTimers();
  const child = new Child();
  const healthProbe = vi.fn(async () => null);
  const tunnel = new ManagedSshTunnel({
    ...options,
    localPort: 4001,
    spawnProcess: () => child,
    healthProbe,
  });
  const starting = expect(tunnel.start()).rejects.toMatchObject({ code: "ssh_unavailable" });
  child.emit("error", Object.assign(new Error("Missing SSH"), { code: "ENOENT" }));
  await starting;
  await vi.advanceTimersByTimeAsync(1000);
  expect(healthProbe).toHaveBeenCalledOnce();
  await tunnel.close();
});

it("retains a running child after startup cleanup fails", async () => {
  vi.useFakeTimers();
  const child = new Child();
  child.pid = 123;
  child.kill.mockReturnValue(false);
  const spawnProcess = vi.fn(() => child);
  const tunnel = new ManagedSshTunnel({
    ...options,
    localPort: 4001,
    spawnProcess,
    healthProbe: async () => null,
  });
  const starting = expect(tunnel.start()).rejects.toMatchObject({ code: "connection_closed" });
  child.emit("error", Object.assign(new Error("Kill failed"), { code: "EPERM" }));
  await vi.advanceTimersByTimeAsync(5_000);
  await starting;

  const restarting = expect(tunnel.start()).rejects.toMatchObject({ code: "connection_closed" });
  await vi.advanceTimersByTimeAsync(5_000);
  await restarting;
  expect(spawnProcess).toHaveBeenCalledOnce();

  const closing = expect(tunnel.close()).rejects.toMatchObject({ code: "connection_closed" });
  await vi.advanceTimersByTimeAsync(5_000);
  await closing;
  expect(tunnel.state).not.toBe("closed");
  const retry = tunnel.close();
  child.emit("exit", 0, "SIGKILL");
  await retry;
  expect(tunnel.state).toBe("closed");
});
