import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export interface HostActivity {
  activeRunCount: number;
  activePtyCount: number;
}

function assertIdle(activity: HostActivity): void {
  if (activity.activeRunCount > 0 || activity.activePtyCount > 0) {
    throw new Error(
      `Refusing host activation with ${activity.activeRunCount} active runs and ${activity.activePtyCount} active PTYs`,
    );
  }
}

export class VersionedHostInstallation {
  private readonly versionsRoot: string;

  constructor(private readonly root: string) {
    this.versionsRoot = join(root, "versions");
    mkdirSync(this.versionsRoot, { recursive: true });
  }

  stage(version: string, sourceDirectory: string): string {
    this.assertVersion(version);
    const target = this.versionPath(version);
    if (existsSync(target))
      throw new Error(`Host version ${version} already exists`);
    cpSync(sourceDirectory, target, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    return target;
  }

  activate(version: string, activity: HostActivity): void {
    assertIdle(activity);
    this.assertInstalled(version);
    const currentVersion = this.currentVersion();
    if (currentVersion && currentVersion !== version) {
      this.replaceLink("previous", currentVersion);
    }
    this.replaceLink("current", version);
  }

  rollback(activity: HostActivity): string {
    assertIdle(activity);
    const previous = this.linkedVersion("previous");
    if (!previous)
      throw new Error("No previous graft-host version is available");
    this.assertInstalled(previous);
    const current = this.currentVersion();
    this.replaceLink("current", previous);
    if (current) this.replaceLink("previous", current);
    return previous;
  }

  currentVersion(): string | null {
    return this.linkedVersion("current");
  }

  private versionPath(version: string): string {
    return join(this.versionsRoot, version);
  }

  private assertVersion(version: string): void {
    if (!VERSION_PATTERN.test(version)) {
      throw new Error(`Invalid graft-host version: ${version}`);
    }
  }

  private assertInstalled(version: string): void {
    this.assertVersion(version);
    const path = this.versionPath(version);
    if (!existsSync(path) || !lstatSync(path).isDirectory()) {
      throw new Error(`Host version ${version} is not installed`);
    }
  }

  private linkedVersion(name: "current" | "previous"): string | null {
    const path = join(this.root, name);
    try {
      if (!lstatSync(path).isSymbolicLink()) return null;
      const version = basename(readlinkSync(path));
      this.assertVersion(version);
      return version;
    } catch {
      return null;
    }
  }

  private replaceLink(name: "current" | "previous", version: string): void {
    const target = this.versionPath(version);
    const resolvedTarget = resolve(target);
    const resolvedVersions = `${resolve(this.versionsRoot)}/`;
    if (!resolvedTarget.startsWith(resolvedVersions)) {
      throw new Error(
        "Refusing activation outside the host versions directory",
      );
    }
    const link = join(this.root, name);
    const temporary = join(this.root, `.${name}-${randomUUID()}`);
    symlinkSync(join("versions", version), temporary);
    try {
      renameSync(temporary, link);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
}
