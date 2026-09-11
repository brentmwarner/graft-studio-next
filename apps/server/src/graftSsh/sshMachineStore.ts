import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { GraftDesktopCapabilityListSchema } from "@graft/desktop-contract";
import type { GraftDesktopBootstrapResponse, GraftDesktopEnrollmentResponse } from "@graft/desktop-contract";

import { parseSshTarget } from "./sshTarget";
import type { ResolvedSshTarget, SavedSshMachine } from "./sshRemoteTypes";

interface MachineFile {
  machines: SavedSshMachine[];
}

function emptyFile(): MachineFile {
  return { machines: [] };
}

export class SshMachineStore {
  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  }

  private read(): MachineFile {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as MachineFile;
      if (!parsed || !Array.isArray(parsed.machines)) return emptyFile();
      return {
        machines: parsed.machines.map((machine) => ({
          ...machine,
          capabilities: GraftDesktopCapabilityListSchema.parse(machine.capabilities ?? []),
        })),
      };
    } catch {
      return emptyFile();
    }
  }

  private write(file: MachineFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporary, this.filePath);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  list(): SavedSshMachine[] {
    return [...this.read().machines].sort((left, right) => {
      const leftSeen = left.lastConnectedAt ?? 0;
      const rightSeen = right.lastConnectedAt ?? 0;
      if (leftSeen !== rightSeen) return rightSeen - leftSeen;
      return right.updatedAt - left.updatedAt;
    });
  }

  get(id: string): SavedSshMachine | null {
    return this.read().machines.find((machine) => machine.id === id) ?? null;
  }

  save(input: { id?: string; label: string; sshTarget: string }): SavedSshMachine {
    const label = input.label.trim();
    if (label.length === 0 || label.length > 120) {
      throw new Error("SSH machine label must contain 1 to 120 characters");
    }
    const sshTarget = parseSshTarget(input.sshTarget);
    const file = this.read();
    const existing = input.id ? (file.machines.find((machine) => machine.id === input.id) ?? null) : null;
    const id = existing?.id ?? input.id ?? `machine-${randomUUID()}`;
    const now = Date.now();
    const next: SavedSshMachine = existing
      ? { ...existing, label, sshTarget, updatedAt: now }
      : {
          id,
          label,
          sshTarget,
          effectiveHostname: null,
          effectiveUser: null,
          effectivePort: null,
          environmentId: null,
          environmentLabel: null,
          daemonVersion: null,
          protocolVersion: null,
          capabilities: [],
          sessionId: null,
          secretAccountKey: null,
          createdAt: now,
          updatedAt: now,
          lastConnectedAt: null,
        };
    this.write({
      machines: existing
        ? file.machines.map((machine) => (machine.id === id ? next : machine))
        : [...file.machines, next],
    });
    return next;
  }

  recordConnection(input: {
    machineId: string;
    resolvedTarget: ResolvedSshTarget;
    bootstrap: GraftDesktopBootstrapResponse;
    enrollment: GraftDesktopEnrollmentResponse;
    secretAccountKey: string;
  }): SavedSshMachine {
    const now = Date.now();
    const file = this.read();
    const existing = file.machines.find((machine) => machine.id === input.machineId);
    if (!existing) throw new Error("SSH machine does not exist");
    const next: SavedSshMachine = {
      ...existing,
      effectiveHostname: input.resolvedTarget.hostname,
      effectiveUser: input.resolvedTarget.user,
      effectivePort: input.resolvedTarget.port,
      environmentId: input.bootstrap.environmentId,
      environmentLabel: input.bootstrap.environmentLabel,
      daemonVersion: input.bootstrap.daemonVersion,
      protocolVersion: input.bootstrap.protocolVersion,
      capabilities: [...input.enrollment.session.grants],
      sessionId: input.enrollment.session.sessionId,
      secretAccountKey: input.secretAccountKey,
      updatedAt: now,
      lastConnectedAt: now,
    };
    this.write({
      machines: file.machines.map((machine) => (machine.id === input.machineId ? next : machine)),
    });
    return next;
  }

  delete(id: string): SavedSshMachine | null {
    const file = this.read();
    const existing = file.machines.find((machine) => machine.id === id) ?? null;
    if (!existing) return null;
    this.write({ machines: file.machines.filter((machine) => machine.id !== id) });
    return existing;
  }
}

export function defaultSshMachineStorePath(stateDir: string): string {
  return join(stateDir, "graft-ssh-machines.json");
}
