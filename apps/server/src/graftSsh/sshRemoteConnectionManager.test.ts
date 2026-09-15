import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GRAFT_DESKTOP_ENDPOINTS, GRAFT_DESKTOP_PROTOCOL_VERSION } from "@graft/desktop-contract";

import { ManagedSshTunnel, type TunnelProcess } from "./managedSshTunnel";
import { SshMachineStore } from "./sshMachineStore";
import { SshRemoteConnectionManager } from "./sshRemoteConnectionManager";
import { SshSecretStore } from "./sshSecretStore";
import type { SshCommandRunner } from "./sshTarget";

const paths: string[] = [];

class FakeTunnelProcess extends EventEmitter implements TunnelProcess {
  pid: number | undefined;
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.exitCode = 0;
    this.emit("exit", 0, signal ?? null);
    return true;
  }
}

class MemorySecretStore extends SshSecretStore {
  readonly values = new Map<string, string>();

  constructor() {
    super(join(tmpdir(), `graft-ssh-secrets-${randomUUID()}.json`));
  }

  override get(accountKey: string): string | null {
    return this.values.get(accountKey) ?? null;
  }

  override set(accountKey: string, bearer: string): void {
    this.values.set(accountKey, bearer);
  }

  override delete(accountKey: string): void {
    this.values.delete(accountKey);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const path of paths.splice(0)) {
    rmSync(path, { force: true });
  }
});

describe("SshRemoteConnectionManager", () => {
  const retryOperations = ["none", "disconnect", "closeAll"] as const;
  it.each(retryOperations)("connects and removes (retry: %s)", async (retryOperation) => {
    const environmentId = "host-fedora-workstation-01";
    const bearer = "desktop-bearer-value-0000000000000000001";
    const enrollmentToken = "enrollment-token-value-000000000000000001";
    let revocationCount = 0;
    const httpServer = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === GRAFT_DESKTOP_ENDPOINTS.health) {
        response.end(
          JSON.stringify({
            service: "graft-host",
            protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
            daemonVersion: "0.2.0",
            environmentId,
            environmentLabel: "Fedora workstation",
            platform: { os: "linux", arch: "x64", libc: "glibc" },
            port: 47_831,
            capabilities: ["projects", "threads", "diagnostics"],
            cursor: 8,
            replayFloor: 2,
            activeRunCount: 0,
            activePtyCount: 0,
          }),
        );
        return;
      }
      if (request.url === GRAFT_DESKTOP_ENDPOINTS.enroll) {
        response.end(
          JSON.stringify({
            protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
            session: {
              sessionId: "session-desktop-01",
              environmentId,
              profile: "desktop_occupancy",
              clientId: "desktop-client-01",
              clientLabel: "Brent's Mac",
              grants: ["projects", "threads", "diagnostics"],
              createdAt: 1,
              expiresAt: Date.now() + 10_000,
              lastSeenAt: 1,
              revokedAt: null,
            },
            bearer,
          }),
        );
        return;
      }
      if (
        request.method === "DELETE" &&
        request.url === GRAFT_DESKTOP_ENDPOINTS.session &&
        request.headers.authorization === `Bearer ${bearer}`
      ) {
        revocationCount += 1;
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    });
    await new Promise<void>((resolveListen) => {
      httpServer.listen(0, "127.0.0.1", () => resolveListen());
    });
    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected HTTP test port");
    }
    const bootstrap = {
      protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
      environmentId,
      environmentLabel: "Fedora workstation",
      daemonVersion: "0.2.0",
      platform: { os: "linux", arch: "x64", libc: "glibc" },
      port: 47_831,
      enrollmentToken,
      enrollmentExpiresAt: Date.now() + 10_000,
      activeRunCount: 0,
      activePtyCount: 0,
    } as const;
    const commandRunner = vi.fn<SshCommandRunner>(async (_executable, arguments_) => {
      if (arguments_[0] === "-G") {
        return {
          stdout: "hostname fedora.tail.example\nuser brent\nport 22\nproxyjump none\n",
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: JSON.stringify(bootstrap), stderr: "", exitCode: 0 };
    });
    const storePath = join(tmpdir(), `graft-ssh-manager-${randomUUID()}.json`);
    paths.push(storePath);
    const machineStore = new SshMachineStore(storePath);
    const secretStore = new MemorySecretStore();
    let tunnel!: ManagedSshTunnel;
    const manager = new SshRemoteConnectionManager({
      machineStore,
      secretStore,
      hostArchivePath: "/unused/host.tgz",
      hostVersion: "0.2.0",
      clientId: "desktop-client-01",
      clientLabel: "Brent's Mac",
      clientVersion: "0.2.0",
      commandRunner,
      createTunnel: (options) => {
        tunnel = new ManagedSshTunnel({
          ...options,
          localPort: address.port,
          spawnProcess: () => new FakeTunnelProcess(),
        });
        return tunnel;
      },
    });
    const saved = manager.saveMachine({
      label: "Fedora",
      sshTarget: "fedora",
    });
    const connection = await manager.connect(saved.id);
    expect(connection).toMatchObject({
      localPort: address.port,
      machine: { environmentId, effectiveHostname: "fedora.tail.example" },
      environment: { environmentId, cursor: 8, replayFloor: 2 },
      session: { profile: "desktop_occupancy" },
      bearer,
    });
    expect(connection.routes.httpBaseUrl).toBe(`http://127.0.0.1:${address.port}`);
    expect(secretStore.values.size).toBe(1);
    expect([...secretStore.values.values()]).toEqual([bearer]);
    expect(manager.listMachines()[0]).not.toHaveProperty("bearer");
    expect(manager.listMachines()[0]).not.toHaveProperty("httpBaseUrl");
    if (retryOperation !== "none") {
      vi.spyOn(tunnel, "close").mockRejectedValueOnce(new Error("SSH process did not exit"));
      await expect(
        retryOperation === "closeAll" ? manager.closeAll() : manager.disconnect(saved.id),
      ).rejects.toThrow("SSH process did not exit");
      expect(manager.listMachineSummaries()[0]?.connected).toBe(true);
      if (retryOperation === "closeAll") {
        await manager.closeAll();
        expect(manager.activeConnection(saved.id)).toBeNull();
      } else {
        await expect(manager.connect(saved.id)).rejects.toThrow("SSH process did not exit");
      }
    }
    await expect(manager.deleteMachine(saved.id)).resolves.toBe(true);
    expect(revocationCount).toBe(
      retryOperation === "disconnect" ? 2 : retryOperation === "closeAll" ? 0 : 1,
    );
    expect(secretStore.values.size).toBe(0);
    await new Promise<void>((resolveClose, rejectClose) => {
      httpServer.close((error) => {
        if (error) rejectClose(error);
        else resolveClose();
      });
    });
  });

  it("revokes a newly enrolled session when secret storage rejects its bearer", async () => {
    const environmentId = "host-fedora-secure-store";
    const bearer = "desktop-bearer-value-0000000000000000002";
    let revokedBearer: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith(GRAFT_DESKTOP_ENDPOINTS.health)) {
          return new Response(
            JSON.stringify({
              service: "graft-host",
              protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
              daemonVersion: "0.2.0",
              environmentId,
              environmentLabel: "Fedora workstation",
              platform: { os: "linux", arch: "x64", libc: "glibc" },
              port: 47_831,
              capabilities: ["projects", "diagnostics"],
              cursor: 0,
              replayFloor: 0,
              activeRunCount: 0,
              activePtyCount: 0,
            }),
            { status: 200 },
          );
        }
        if (url.endsWith(GRAFT_DESKTOP_ENDPOINTS.enroll)) {
          return new Response(
            JSON.stringify({
              protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
              session: {
                sessionId: "session-secure-store-failure",
                environmentId,
                profile: "desktop_occupancy",
                clientId: "desktop-client-01",
                clientLabel: "Brent's Mac",
                grants: ["projects", "diagnostics"],
                createdAt: 1,
                expiresAt: Date.now() + 10_000,
                lastSeenAt: 1,
                revokedAt: null,
              },
              bearer,
            }),
            { status: 200 },
          );
        }
        if (url.endsWith(GRAFT_DESKTOP_ENDPOINTS.session) && init?.method === "DELETE") {
          revokedBearer = new Headers(init.headers).get("authorization");
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(null, { status: 404 });
      }),
    );
    const bootstrap = {
      protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
      environmentId,
      environmentLabel: "Fedora workstation",
      daemonVersion: "0.2.0",
      platform: { os: "linux", arch: "x64", libc: "glibc" },
      port: 47_831,
      enrollmentToken: "enrollment-token-value-000000000000000002",
      enrollmentExpiresAt: Date.now() + 10_000,
      activeRunCount: 0,
      activePtyCount: 0,
    } as const;
    const commandRunner = vi.fn<SshCommandRunner>(async (_executable, arguments_) =>
      arguments_[0] === "-G"
        ? {
            stdout: "hostname fedora\nuser brent\nport 22\nproxyjump none\n",
            stderr: "",
            exitCode: 0,
          }
        : {
            stdout: JSON.stringify(bootstrap),
            stderr: "",
            exitCode: 0,
          },
    );
    const storePath = join(tmpdir(), `graft-ssh-manager-${randomUUID()}.json`);
    paths.push(storePath);
    const machineStore = new SshMachineStore(storePath);
    const secretStore = new MemorySecretStore();
    secretStore.set = () => {
      throw new Error("keyring unavailable");
    };
    const manager = new SshRemoteConnectionManager({
      machineStore,
      secretStore,
      hostArchivePath: "/unused/host.tgz",
      hostVersion: "0.2.0",
      clientId: "desktop-client-01",
      clientLabel: "Brent's Mac",
      clientVersion: "0.2.0",
      commandRunner,
      createTunnel: (options) =>
        new ManagedSshTunnel({
          ...options,
          localPort: 43_123,
          spawnProcess: () => new FakeTunnelProcess(),
        }),
    });
    const machine = manager.saveMachine({
      label: "Fedora",
      sshTarget: "fedora",
    });

    await expect(manager.connect(machine.id)).rejects.toMatchObject({
      code: "secret_store_unavailable",
    });
    expect(revokedBearer).toBe(`Bearer ${bearer}`);
    expect(machineStore.get(machine.id)?.sessionId).toBeNull();
  });

  it("removes a saved machine when remote session revoke fails", async () => {
    const environmentId = "host-fedora-offline";
    const bearer = "desktop-bearer-value-0000000000000000003";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith(GRAFT_DESKTOP_ENDPOINTS.health)) {
          return new Response(
            JSON.stringify({
              service: "graft-host",
              protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
              daemonVersion: "0.2.0",
              environmentId,
              environmentLabel: "Fedora workstation",
              platform: { os: "linux", arch: "x64", libc: "glibc" },
              port: 47_831,
              capabilities: ["projects", "diagnostics"],
              cursor: 0,
              replayFloor: 0,
              activeRunCount: 0,
              activePtyCount: 0,
            }),
            { status: 200 },
          );
        }
        if (url.endsWith(GRAFT_DESKTOP_ENDPOINTS.enroll)) {
          return new Response(
            JSON.stringify({
              protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
              session: {
                sessionId: "session-offline-delete",
                environmentId,
                profile: "desktop_occupancy",
                clientId: "desktop-client-01",
                clientLabel: "Brent's Mac",
                grants: ["projects", "diagnostics"],
                createdAt: 1,
                expiresAt: Date.now() + 10_000,
                lastSeenAt: 1,
                revokedAt: null,
              },
              bearer,
            }),
            { status: 200 },
          );
        }
        if (url.endsWith(GRAFT_DESKTOP_ENDPOINTS.session) && init?.method === "DELETE") {
          throw new TypeError("fetch failed");
        }
        return new Response(null, { status: 404 });
      }),
    );
    const bootstrap = {
      protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
      environmentId,
      environmentLabel: "Fedora workstation",
      daemonVersion: "0.2.0",
      platform: { os: "linux", arch: "x64", libc: "glibc" },
      port: 47_831,
      enrollmentToken: "enrollment-token-value-000000000000000003",
      enrollmentExpiresAt: Date.now() + 10_000,
      activeRunCount: 0,
      activePtyCount: 0,
    } as const;
    const commandRunner = vi.fn<SshCommandRunner>(async (_executable, arguments_) =>
      arguments_[0] === "-G"
        ? {
            stdout: "hostname fedora\nuser brent\nport 22\nproxyjump none\n",
            stderr: "",
            exitCode: 0,
          }
        : {
            stdout: JSON.stringify(bootstrap),
            stderr: "",
            exitCode: 0,
          },
    );
    const storePath = join(tmpdir(), `graft-ssh-manager-${randomUUID()}.json`);
    paths.push(storePath);
    const machineStore = new SshMachineStore(storePath);
    const secretStore = new MemorySecretStore();
    const manager = new SshRemoteConnectionManager({
      machineStore,
      secretStore,
      hostArchivePath: "/unused/host.tgz",
      hostVersion: "0.2.0",
      clientId: "desktop-client-01",
      clientLabel: "Brent's Mac",
      clientVersion: "0.2.0",
      commandRunner,
      createTunnel: (options) =>
        new ManagedSshTunnel({
          ...options,
          localPort: 43_124,
          spawnProcess: () => new FakeTunnelProcess(),
        }),
    });
    const machine = manager.saveMachine({
      label: "Fedora",
      sshTarget: "fedora",
    });
    await manager.connect(machine.id);
    expect(secretStore.values.size).toBe(1);
    await expect(manager.deleteMachine(machine.id)).resolves.toBe(true);
    expect(machineStore.get(machine.id)).toBeNull();
    expect(secretStore.values.size).toBe(0);
    expect(manager.activeConnection(machine.id)).toBeNull();
  });

  it("drops a machine from connected summaries when the SSH tunnel fails", async () => {
    const environmentId = "host-fedora-tunnel-drop";
    const bearer = "desktop-bearer-value-0000000000000000004";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith(GRAFT_DESKTOP_ENDPOINTS.health)) {
          return new Response(
            JSON.stringify({
              service: "graft-host",
              protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
              daemonVersion: "0.2.0",
              environmentId,
              environmentLabel: "Fedora workstation",
              platform: { os: "linux", arch: "x64", libc: "glibc" },
              port: 47_831,
              capabilities: ["projects", "threads"],
              cursor: 0,
              replayFloor: 0,
              activeRunCount: 0,
              activePtyCount: 0,
            }),
            { status: 200 },
          );
        }
        if (url.endsWith(GRAFT_DESKTOP_ENDPOINTS.enroll)) {
          return new Response(
            JSON.stringify({
              protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
              session: {
                sessionId: "session-tunnel-drop",
                environmentId,
                profile: "desktop_occupancy",
                clientId: "desktop-client-01",
                clientLabel: "Brent's Mac",
                grants: ["projects", "threads"],
                createdAt: 1,
                expiresAt: Date.now() + 10_000,
                lastSeenAt: 1,
                revokedAt: null,
              },
              bearer,
            }),
            { status: 200 },
          );
        }
        if (url.endsWith(GRAFT_DESKTOP_ENDPOINTS.session) && init?.method === "DELETE") {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(null, { status: 404 });
      }),
    );
    const bootstrap = {
      protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
      environmentId,
      environmentLabel: "Fedora workstation",
      daemonVersion: "0.2.0",
      platform: { os: "linux", arch: "x64", libc: "glibc" },
      port: 47_831,
      enrollmentToken: "enrollment-token-value-000000000000000004",
      enrollmentExpiresAt: Date.now() + 10_000,
      activeRunCount: 0,
      activePtyCount: 0,
    } as const;
    const commandRunner = vi.fn<SshCommandRunner>(async (_executable, arguments_) =>
      arguments_[0] === "-G"
        ? {
            stdout: "hostname fedora\nuser brent\nport 22\nproxyjump none\n",
            stderr: "",
            exitCode: 0,
          }
        : {
            stdout: JSON.stringify(bootstrap),
            stderr: "",
            exitCode: 0,
          },
    );
    const storePath = join(tmpdir(), `graft-ssh-manager-${randomUUID()}.json`);
    paths.push(storePath);
    const machineStore = new SshMachineStore(storePath);
    const secretStore = new MemorySecretStore();
    const tunnelProcesses: FakeTunnelProcess[] = [];
    const manager = new SshRemoteConnectionManager({
      machineStore,
      secretStore,
      hostArchivePath: "/unused/host.tgz",
      hostVersion: "0.2.0",
      clientId: "desktop-client-01",
      clientLabel: "Brent's Mac",
      clientVersion: "0.2.0",
      commandRunner,
      createTunnel: (options) =>
        new ManagedSshTunnel({
          ...options,
          localPort: 43_125,
          reconnectDelaysMs: [1],
          spawnProcess: () => {
            if (tunnelProcesses.length > 0) throw new Error("ssh gone");
            const child = new FakeTunnelProcess();
            tunnelProcesses.push(child);
            return child;
          },
        }),
    });
    const machine = manager.saveMachine({
      label: "Fedora",
      sshTarget: "fedora",
    });
    await manager.connect(machine.id);
    expect(manager.listMachineSummaries()[0]?.connected).toBe(true);
    const firstProcess = tunnelProcesses[0];
    if (!firstProcess) throw new Error("SSH tunnel process was not started");
    firstProcess.kill("SIGTERM");
    await vi.waitFor(() => {
      expect(manager.activeConnection(machine.id)).toBeNull();
    });
    expect(manager.listMachineSummaries()[0]?.connected).toBe(false);
  });

  it("revokes the desktop session when disconnecting an established connection", async () => {
    const environmentId = "host-fedora-disconnect-revoke";
    const bearer = "desktop-bearer-value-0000000000000000005";
    let revocationCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith(GRAFT_DESKTOP_ENDPOINTS.health)) {
          return new Response(
            JSON.stringify({
              service: "graft-host",
              protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
              daemonVersion: "0.2.0",
              environmentId,
              environmentLabel: "Fedora workstation",
              platform: { os: "linux", arch: "x64", libc: "glibc" },
              port: 47_831,
              capabilities: ["projects", "diagnostics"],
              cursor: 0,
              replayFloor: 0,
              activeRunCount: 0,
              activePtyCount: 0,
            }),
            { status: 200 },
          );
        }
        if (url.endsWith(GRAFT_DESKTOP_ENDPOINTS.enroll)) {
          return new Response(
            JSON.stringify({
              protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
              session: {
                sessionId: "session-disconnect-revoke",
                environmentId,
                profile: "desktop_occupancy",
                clientId: "desktop-client-01",
                clientLabel: "Brent's Mac",
                grants: ["projects", "diagnostics"],
                createdAt: 1,
                expiresAt: Date.now() + 10_000,
                lastSeenAt: 1,
                revokedAt: null,
              },
              bearer,
            }),
            { status: 200 },
          );
        }
        if (url.endsWith(GRAFT_DESKTOP_ENDPOINTS.session) && init?.method === "DELETE") {
          revocationCount += 1;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(null, { status: 404 });
      }),
    );
    const bootstrap = {
      protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
      environmentId,
      environmentLabel: "Fedora workstation",
      daemonVersion: "0.2.0",
      platform: { os: "linux", arch: "x64", libc: "glibc" },
      port: 47_831,
      enrollmentToken: "enrollment-token-value-000000000000000005",
      enrollmentExpiresAt: Date.now() + 10_000,
      activeRunCount: 0,
      activePtyCount: 0,
    } as const;
    const commandRunner = vi.fn<SshCommandRunner>(async (_executable, arguments_) =>
      arguments_[0] === "-G"
        ? {
            stdout: "hostname fedora\nuser brent\nport 22\nproxyjump none\n",
            stderr: "",
            exitCode: 0,
          }
        : {
            stdout: JSON.stringify(bootstrap),
            stderr: "",
            exitCode: 0,
          },
    );
    const storePath = join(tmpdir(), `graft-ssh-manager-${randomUUID()}.json`);
    paths.push(storePath);
    const manager = new SshRemoteConnectionManager({
      machineStore: new SshMachineStore(storePath),
      secretStore: new MemorySecretStore(),
      hostArchivePath: "/unused/host.tgz",
      hostVersion: "0.2.0",
      clientId: "desktop-client-01",
      clientLabel: "Brent's Mac",
      clientVersion: "0.2.0",
      commandRunner,
      createTunnel: (options) =>
        new ManagedSshTunnel({
          ...options,
          localPort: 43_126,
          spawnProcess: () => new FakeTunnelProcess(),
        }),
    });
    const machine = manager.saveMachine({
      label: "Fedora",
      sshTarget: "fedora",
    });
    await manager.connect(machine.id);
    await manager.disconnect(machine.id);
    expect(revocationCount).toBe(1);
    expect(manager.activeConnection(machine.id)).toBeNull();
  });
});

describe("SSH connection cancellation", () => {
  it.each(["disconnect", "closeAll", "deleteMachine"] as const)(
    "does not publish a late connection after %s",
    async (operation) => {
      const path = join(tmpdir(), `graft-ssh-cancel-${randomUUID()}.json`);
      paths.push(path);
      const target = Promise.withResolvers<{ stdout: string; stderr: string; exitCode: number }>();
      const runner = vi.fn<SshCommandRunner>(() => target.promise);
      const createTunnel = vi.fn();
      const manager = new SshRemoteConnectionManager({
        machineStore: new SshMachineStore(path),
        secretStore: new MemorySecretStore(),
        hostArchivePath: "/unused",
        hostVersion: "0.2.1",
        clientId: "test",
        clientLabel: "test",
        clientVersion: "0.2.1",
        commandRunner: runner,
        createTunnel,
      });
      const machine = manager.saveMachine({ label: "Test", sshTarget: "test@machine" });
      const connecting = manager.connect(machine.id);
      const rejected = expect(connecting).rejects.toMatchObject({ code: "connection_closed" });
      await vi.waitFor(() => expect(runner).toHaveBeenCalledOnce());
      const closing =
        operation === "closeAll" ? manager.closeAll() : manager[operation](machine.id);
      target.resolve({ exitCode: 0, stdout: "hostname machine\nuser test\nport 22\n", stderr: "" });
      await closing;
      await rejected;
      expect(runner).toHaveBeenCalledOnce();
      expect(createTunnel).not.toHaveBeenCalled();
      expect(manager.activeConnection(machine.id)).toBeNull();
    },
  );
});

describe("SSH startup failure recovery", () => {
  const bootstrap = {
    protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
    environmentId: "host-startup-failure",
    environmentLabel: "Test host",
    daemonVersion: "0.2.0",
    platform: { os: "linux", arch: "x64", libc: "glibc" },
    port: 47_831,
    enrollmentToken: "enrollment-token-value-000000000000000001",
    enrollmentExpiresAt: Date.now() + 10_000,
    activeRunCount: 0,
    activePtyCount: 0,
  } as const;

  function createManager(
    createTunnel: (options: ConstructorParameters<typeof ManagedSshTunnel>[0]) => ManagedSshTunnel,
  ) {
    const path = join(tmpdir(), `graft-ssh-startup-failure-${randomUUID()}.json`);
    paths.push(path);
    const manager = new SshRemoteConnectionManager({
      machineStore: new SshMachineStore(path),
      secretStore: new MemorySecretStore(),
      hostArchivePath: "/unused",
      hostVersion: "0.2.0",
      clientId: "test",
      clientLabel: "test",
      clientVersion: "0.2.0",
      commandRunner: async (_executable, args) => ({
        stdout:
          args[0] === "-G" ? "hostname machine\nuser test\nport 22\n" : JSON.stringify(bootstrap),
        stderr: "",
        exitCode: 0,
      }),
      createTunnel,
    });
    const machine = manager.saveMachine({ label: "Test", sshTarget: "test@machine" });
    return { manager, machine };
  }

  it.each(["disconnect", "closeAll", "connect"] as const)(
    "retains an unreaped startup process for a later %s attempt",
    async (operation) => {
      vi.useFakeTimers();
      const child = new FakeTunnelProcess();
      child.pid = 123;
      const kill = vi.spyOn(child, "kill").mockReturnValue(false);
      const spawnProcess = vi.fn(() => child);
      let tunnel!: ManagedSshTunnel;
      const { manager, machine } = createManager((options) => {
        tunnel = new ManagedSshTunnel({
          ...options,
          localPort: 43_127,
          spawnProcess,
          healthProbe: async () => null,
        });
        return tunnel;
      });
      const connecting = expect(manager.connect(machine.id)).rejects.toMatchObject({
        code: "connection_closed",
      });
      await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
      child.emit("error", Object.assign(new Error("Kill failed"), { code: "EPERM" }));
      await vi.advanceTimersByTimeAsync(10_000);
      await connecting;

      const retry = expect(
        operation === "closeAll" ? manager.closeAll() : manager[operation](machine.id),
      ).rejects.toMatchObject({ code: "connection_closed" });
      await vi.advanceTimersByTimeAsync(5_000);
      await retry;
      expect(spawnProcess).toHaveBeenCalledOnce();
      expect(kill.mock.calls.map(([signal]) => signal)).toEqual([
        "SIGTERM",
        "SIGKILL",
        "SIGTERM",
        "SIGKILL",
        "SIGTERM",
        "SIGKILL",
      ]);
      expect(tunnel.state).not.toBe("closed");

      const disconnecting = manager.disconnect(machine.id);
      await vi.waitFor(() => expect(kill).toHaveBeenCalledTimes(7));
      child.emit("exit", 0, "SIGKILL");
      await disconnecting;
      expect(tunnel.state).toBe("closed");
      await manager.closeAll();
      expect(kill).toHaveBeenCalledTimes(7);
    },
  );

  it.each(["network", "http", "json", "schema"] as const)(
    "reports a retryable SSH error and closes the tunnel after a %s health failure",
    async (failure) => {
      const child = new FakeTunnelProcess();
      const { manager, machine } = createManager(
        (options) =>
          new ManagedSshTunnel({
            ...options,
            localPort: 43_128,
            spawnProcess: () => child,
            healthProbe: async () => ({
              ...bootstrap,
              service: "graft-host",
              capabilities: ["projects"],
              cursor: 0,
              replayFloor: 0,
            }),
          }),
      );
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
        if (failure === "network") throw new TypeError("fetch failed");
        return new Response(failure === "json" ? "not JSON" : "{}", {
          status: failure === "http" ? 503 : 200,
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      await expect(manager.connect(machine.id)).rejects.toMatchObject({
        name: "SshRemoteError",
        code: "tunnel_failed",
        retryable: true,
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(child.exitCode).toBe(0);
      expect(manager.activeConnection(machine.id)).toBeNull();
      expect(manager.listMachines()[0]?.sessionId).toBeNull();
      await manager.closeAll();
    },
  );
});
