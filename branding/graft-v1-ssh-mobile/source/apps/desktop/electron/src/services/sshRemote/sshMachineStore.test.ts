import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SshMachineStore } from "./sshMachineStore.js";

const require = createRequire(import.meta.url);
const paths: string[] = [];

function databasePath(): string {
  const path = join(tmpdir(), `graft-ssh-machines-${randomUUID()}.db`);
  paths.push(path);
  return path;
}

afterEach(() => {
  for (const path of paths.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-shm`, { force: true });
    rmSync(`${path}-wal`, { force: true });
  }
});

describe("SshMachineStore", () => {
  it("persists machine and host identity without bearer text or tunnel routes", () => {
    const path = databasePath();
    const first = new SshMachineStore(path);
    const machine = first.save({ label: "Fedora", sshTarget: "fedora" });
    first.recordConnection({
      machineId: machine.id,
      resolvedTarget: {
        target: "fedora",
        hostname: "fedora.tail.example",
        user: "brent",
        port: 22,
        proxyJump: null,
      },
      bootstrap: {
        protocolVersion: 1,
        environmentId: "host-fedora-workstation-01",
        environmentLabel: "Fedora workstation",
        daemonVersion: "0.1.0",
        platform: { os: "linux", arch: "x64", libc: "glibc" },
        port: 47_831,
        enrollmentToken: "enrollment-token-value-000000000000000001",
        enrollmentExpiresAt: Date.now() + 1_000,
        activeRunCount: 0,
        activePtyCount: 0,
      },
      enrollment: {
        protocolVersion: 1,
        session: {
          sessionId: "session-desktop-01",
          environmentId: "host-fedora-workstation-01",
          profile: "desktop_occupancy",
          clientId: "desktop-client",
          clientLabel: "Brent's Mac",
          grants: ["projects", "threads"],
          createdAt: 1,
          expiresAt: 2,
          lastSeenAt: 1,
          revokedAt: null,
        },
        bearer: "desktop-bearer-secret-never-in-machine-database",
      },
      secretAccountKey: `desktop-host:${machine.id}:session-desktop-01`,
    });
    first.close();

    const raw = readFileSync(path);
    expect(raw.includes(Buffer.from("desktop-bearer-secret"))).toBe(false);
    expect(raw.includes(Buffer.from("127.0.0.1"))).toBe(false);
    const Sqlite = require("better-sqlite3") as typeof import("better-sqlite3");
    const database = new Sqlite(path, { readonly: true });
    const columns = database
      .prepare("PRAGMA table_info(saved_ssh_machines)")
      .all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toContain("bearer");
    expect(columns.map((column) => column.name)).not.toContain("httpBaseUrl");
    database.close();

    const reopened = new SshMachineStore(path);
    expect(reopened.get(machine.id)).toMatchObject({
      sshTarget: "fedora",
      environmentId: "host-fedora-workstation-01",
      sessionId: "session-desktop-01",
      capabilities: ["projects", "threads"],
    });
    reopened.close();
  });

  it("enforces a case-insensitive unique SSH target", () => {
    const store = new SshMachineStore(databasePath());
    store.save({ label: "Fedora", sshTarget: "fedora" });
    expect(() =>
      store.save({ label: "Duplicate", sshTarget: "FEDORA" }),
    ).toThrow();
    store.close();
  });

  it("persists remote projects with their machine identity", () => {
    const path = databasePath();
    const store = new SshMachineStore(path);
    const machine = store.save({ label: "Fedora", sshTarget: "fedora" });
    store.recordConnection({
      machineId: machine.id,
      resolvedTarget: {
        target: "fedora",
        hostname: "fedora.tail.example",
        user: "brentmwarner",
        port: 22,
        proxyJump: null,
      },
      bootstrap: {
        protocolVersion: 1,
        environmentId: "host-fedora",
        environmentLabel: "Fedora",
        daemonVersion: "0.1.0",
        platform: { os: "linux", arch: "x64", libc: "glibc" },
        port: 47_831,
        enrollmentToken: "enrollment-token-value-000000000000000001",
        enrollmentExpiresAt: Date.now() + 1_000,
        activeRunCount: 0,
        activePtyCount: 0,
      },
      enrollment: {
        protocolVersion: 1,
        session: {
          sessionId: "session-desktop-01",
          environmentId: "host-fedora",
          profile: "desktop_occupancy",
          clientId: "desktop-client",
          clientLabel: "Brent's Mac",
          grants: ["projects"],
          createdAt: 1,
          expiresAt: 2,
          lastSeenAt: 1,
          revokedAt: null,
        },
        bearer: "desktop-bearer-secret",
      },
      secretAccountKey: `desktop-host:${machine.id}:session-desktop-01`,
    });

    const project = store.saveProject(machine.id, {
      id: "remote-project",
      name: "basecount",
      repoPath: "/home/brentmwarner/workspace/basecount",
      projectKind: "repo",
      spaceId: null,
      sortOrder: 3,
      createdAt: 42,
    });
    expect(project.remoteMachine).toEqual({
      id: machine.id,
      label: "Fedora",
      environmentId: "host-fedora",
    });

    store.renameProject(project.id, "basecount-renamed");
    store.assignProjectToSpace(project.id, null);
    expect(store.listProjects()).toMatchObject([
      { id: project.id, name: "basecount-renamed" },
    ]);
    store.close();

    const reopened = new SshMachineStore(path);
    expect(reopened.getProject(project.id)?.repoPath).toBe(
      "/home/brentmwarner/workspace/basecount",
    );
    reopened.delete(machine.id);
    expect(reopened.listProjects()).toEqual([]);
    reopened.close();
  });
});
