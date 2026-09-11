import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import {
  GraftDesktopCapabilityListSchema,
  ProjectKindSchema,
  type GraftDesktopBootstrapResponse,
  type GraftDesktopEnrollmentResponse,
} from "@graft/shared";
import { parseSshTarget } from "./sshTarget.js";
import type {
  ResolvedSshTarget,
  SavedSshMachine,
  SavedSshProject,
} from "./sshRemoteTypes.js";

const require = createRequire(import.meta.url);
const SCHEMA_VERSION = 2;

interface MachineRow {
  id: string;
  label: string;
  sshTarget: string;
  effectiveHostname: string | null;
  effectiveUser: string | null;
  effectivePort: number | null;
  environmentId: string | null;
  environmentLabel: string | null;
  daemonVersion: string | null;
  protocolVersion: number | null;
  capabilitiesJson: string;
  sessionId: string | null;
  secretAccountKey: string | null;
  createdAt: number;
  updatedAt: number;
  lastConnectedAt: number | null;
}

interface ProjectRow {
  id: string;
  machineId: string;
  name: string;
  repoPath: string;
  projectKind: string;
  spaceId: string | null;
  sortOrder: number;
  createdAt: number;
  machineLabel: string;
  environmentId: string;
}

function machineFromRow(row: MachineRow): SavedSshMachine {
  const { capabilitiesJson, ...machine } = row;
  return {
    ...machine,
    capabilities: GraftDesktopCapabilityListSchema.parse(
      JSON.parse(capabilitiesJson),
    ),
  };
}

function projectFromRow(row: ProjectRow): SavedSshProject {
  return {
    id: row.id,
    name: row.name,
    repoPath: row.repoPath,
    projectKind: ProjectKindSchema.parse(row.projectKind),
    spaceId: row.spaceId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    remoteMachine: {
      id: row.machineId,
      label: row.machineLabel,
      environmentId: row.environmentId,
    },
  };
}

export class SshMachineStore {
  private readonly database: BetterSqlite3.Database;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    const Sqlite = require("better-sqlite3") as typeof import("better-sqlite3");
    this.database = new Sqlite(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS ssh_machine_schema_version (
        version INTEGER NOT NULL
      );
    `);
    const version = this.database
      .prepare("SELECT version FROM ssh_machine_schema_version LIMIT 1")
      .get() as { version: number } | undefined;
    if (!version) {
      this.database
        .prepare("INSERT INTO ssh_machine_schema_version (version) VALUES (0)")
        .run();
    }
    const currentVersion = version?.version ?? 0;
    if (currentVersion >= SCHEMA_VERSION) return;
    this.database.transaction(() => {
      if (currentVersion < 1) {
        this.database.exec(`
        CREATE TABLE saved_ssh_machines (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 120),
          sshTarget TEXT NOT NULL COLLATE NOCASE UNIQUE
            CHECK(length(sshTarget) BETWEEN 1 AND 255),
          effectiveHostname TEXT,
          effectiveUser TEXT,
          effectivePort INTEGER CHECK(effectivePort BETWEEN 1 AND 65535),
          environmentId TEXT,
          environmentLabel TEXT,
          daemonVersion TEXT,
          protocolVersion INTEGER,
          capabilitiesJson TEXT NOT NULL DEFAULT '[]',
          sessionId TEXT,
          secretAccountKey TEXT,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          lastConnectedAt INTEGER,
          CHECK(updatedAt >= createdAt),
          CHECK(lastConnectedAt IS NULL OR lastConnectedAt >= createdAt)
        );
        CREATE INDEX idx_saved_ssh_machines_recent
          ON saved_ssh_machines(lastConnectedAt DESC, updatedAt DESC);
      `);
      }
      if (currentVersion < 2) {
        this.database.exec(`
          CREATE TABLE saved_ssh_projects (
            id TEXT PRIMARY KEY,
            machineId TEXT NOT NULL REFERENCES saved_ssh_machines(id)
              ON DELETE CASCADE,
            name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 255),
            repoPath TEXT NOT NULL CHECK(length(repoPath) BETWEEN 1 AND 4096),
            projectKind TEXT NOT NULL CHECK(projectKind IN ('repo', 'desktop')),
            spaceId TEXT,
            sortOrder INTEGER NOT NULL,
            createdAt INTEGER NOT NULL,
            UNIQUE(machineId, repoPath)
          );
          CREATE INDEX idx_saved_ssh_projects_order
            ON saved_ssh_projects(sortOrder, createdAt);
        `);
      }
      this.database
        .prepare("UPDATE ssh_machine_schema_version SET version = ?")
        .run(SCHEMA_VERSION);
    })();
  }

  list(): SavedSshMachine[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM saved_ssh_machines
         ORDER BY lastConnectedAt DESC NULLS LAST, updatedAt DESC`,
      )
      .all() as MachineRow[];
    return rows.map(machineFromRow);
  }

  get(id: string): SavedSshMachine | null {
    const row = this.database
      .prepare("SELECT * FROM saved_ssh_machines WHERE id = ? LIMIT 1")
      .get(id) as MachineRow | undefined;
    return row ? machineFromRow(row) : null;
  }

  save(input: {
    id?: string;
    label: string;
    sshTarget: string;
  }): SavedSshMachine {
    const label = input.label.trim();
    if (label.length === 0 || label.length > 120) {
      throw new Error("SSH machine label must contain 1 to 120 characters");
    }
    const sshTarget = parseSshTarget(input.sshTarget);
    const existing = input.id ? this.get(input.id) : null;
    const id = existing?.id ?? input.id ?? `machine-${randomUUID()}`;
    const now = Date.now();
    if (existing) {
      this.database
        .prepare(
          `UPDATE saved_ssh_machines
           SET label = ?, sshTarget = ?, updatedAt = ? WHERE id = ?`,
        )
        .run(label, sshTarget, now, id);
    } else {
      this.database
        .prepare(
          `INSERT INTO saved_ssh_machines
           (id, label, sshTarget, capabilitiesJson, createdAt, updatedAt)
           VALUES (?, ?, ?, '[]', ?, ?)`,
        )
        .run(id, label, sshTarget, now, now);
    }
    const machine = this.get(id);
    if (!machine) throw new Error("SSH machine could not be saved");
    return machine;
  }

  recordConnection(input: {
    machineId: string;
    resolvedTarget: ResolvedSshTarget;
    bootstrap: GraftDesktopBootstrapResponse;
    enrollment: GraftDesktopEnrollmentResponse;
    secretAccountKey: string;
  }): SavedSshMachine {
    const now = Date.now();
    const updated = this.database
      .prepare(
        `UPDATE saved_ssh_machines SET
           effectiveHostname = ?, effectiveUser = ?, effectivePort = ?,
           environmentId = ?, environmentLabel = ?, daemonVersion = ?,
           protocolVersion = ?, capabilitiesJson = ?, sessionId = ?,
           secretAccountKey = ?, updatedAt = ?, lastConnectedAt = ?
         WHERE id = ?`,
      )
      .run(
        input.resolvedTarget.hostname,
        input.resolvedTarget.user,
        input.resolvedTarget.port,
        input.bootstrap.environmentId,
        input.bootstrap.environmentLabel,
        input.bootstrap.daemonVersion,
        input.bootstrap.protocolVersion,
        JSON.stringify(input.enrollment.session.grants),
        input.enrollment.session.sessionId,
        input.secretAccountKey,
        now,
        now,
        input.machineId,
      );
    if (updated.changes !== 1) throw new Error("SSH machine does not exist");
    const machine = this.get(input.machineId);
    if (!machine) throw new Error("SSH machine could not be loaded");
    return machine;
  }

  delete(id: string): SavedSshMachine | null {
    const existing = this.get(id);
    if (!existing) return null;
    this.database
      .prepare("DELETE FROM saved_ssh_machines WHERE id = ?")
      .run(id);
    return existing;
  }

  listProjects(): SavedSshProject[] {
    const rows = this.database
      .prepare(
        `SELECT projects.*, machines.label AS machineLabel,
                machines.environmentId AS environmentId
         FROM saved_ssh_projects projects
         JOIN saved_ssh_machines machines ON machines.id = projects.machineId
         WHERE machines.environmentId IS NOT NULL
         ORDER BY projects.sortOrder, projects.createdAt`,
      )
      .all() as ProjectRow[];
    return rows.map(projectFromRow);
  }

  getProject(id: string): SavedSshProject | null {
    const row = this.database
      .prepare(
        `SELECT projects.*, machines.label AS machineLabel,
                machines.environmentId AS environmentId
         FROM saved_ssh_projects projects
         JOIN saved_ssh_machines machines ON machines.id = projects.machineId
         WHERE projects.id = ? AND machines.environmentId IS NOT NULL
         LIMIT 1`,
      )
      .get(id) as ProjectRow | undefined;
    return row ? projectFromRow(row) : null;
  }

  saveProject(
    machineId: string,
    project: Omit<SavedSshProject, "remoteMachine">,
  ): SavedSshProject {
    this.database
      .prepare(
        `INSERT INTO saved_ssh_projects
          (id, machineId, name, repoPath, projectKind, spaceId, sortOrder, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           machineId = excluded.machineId,
           name = excluded.name,
           repoPath = excluded.repoPath,
           projectKind = excluded.projectKind,
           spaceId = excluded.spaceId,
           sortOrder = excluded.sortOrder`,
      )
      .run(
        project.id,
        machineId,
        project.name,
        project.repoPath,
        project.projectKind,
        project.spaceId,
        project.sortOrder,
        project.createdAt,
      );
    const saved = this.getProject(project.id);
    if (!saved) throw new Error("Remote project could not be saved");
    return saved;
  }

  renameProject(id: string, name: string): boolean {
    return (
      this.database
        .prepare("UPDATE saved_ssh_projects SET name = ? WHERE id = ?")
        .run(name, id).changes === 1
    );
  }

  assignProjectToSpace(id: string, spaceId: string | null): boolean {
    return (
      this.database
        .prepare("UPDATE saved_ssh_projects SET spaceId = ? WHERE id = ?")
        .run(spaceId, id).changes === 1
    );
  }

  reorderProjects(orderedIds: readonly string[]): void {
    const update = this.database.prepare(
      "UPDATE saved_ssh_projects SET sortOrder = ? WHERE id = ?",
    );
    this.database.transaction(() => {
      orderedIds.forEach((id, index) => update.run(index, id));
    })();
  }

  deleteProject(id: string): boolean {
    return (
      this.database
        .prepare("DELETE FROM saved_ssh_projects WHERE id = ?")
        .run(id).changes === 1
    );
  }

  close(): void {
    this.database.close();
  }
}
