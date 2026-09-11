import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export class SshSecretStore {
  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  }

  private read(): Record<string, string> {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const records: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string" && value.length > 0) records[key] = value;
      }
      return records;
    } catch {
      return {};
    }
  }

  private write(records: Record<string, string>): void {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(records)}\n`, { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, this.filePath);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  get(accountKey: string): string | null {
    return this.read()[accountKey] ?? null;
  }

  set(accountKey: string, bearer: string): void {
    const records = this.read();
    records[accountKey] = bearer;
    this.write(records);
  }

  delete(accountKey: string): void {
    const records = this.read();
    if (!(accountKey in records)) return;
    delete records[accountKey];
    this.write(records);
  }
}

export function defaultSshSecretStorePath(secretsDir: string): string {
  return join(secretsDir, "graft-ssh-bearers.json");
}
