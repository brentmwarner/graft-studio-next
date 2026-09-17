import { lstat } from "node:fs/promises";
import { join } from "node:path";

import type { LegacyGraftRuntimeStatus, OrchestrationCommand } from "@graft/contracts";
import { isLegacyGraftThread } from "@graft/shared/legacyGraft";

import type { ServerConfigShape } from "./config";
import { atomicJson } from "./legacyGraft/files";
import {
  getLegacyGraftImportProgress,
  prepareLegacyGraftImport,
  readLegacyGraftThreadArchive,
  runLegacyGraftImport,
} from "./legacyGraft/importService";

type Dispatch = (command: OrchestrationCommand) => Promise<unknown>;

const runtimes = new Map<string, LegacyGraftRuntime>();

export function legacyGraftRuntime(config: Pick<ServerConfigShape, "stateDir" | "mode">) {
  let runtime = runtimes.get(config.stateDir);
  if (!runtime) {
    runtime = new LegacyGraftRuntime({
      directory: join(config.stateDir, "legacy-graft-import"),
      sourceProfile: config.mode === "desktop" ? process.env.GRAFT_LEGACY_USER_DATA : undefined,
    });
    runtimes.set(config.stateDir, runtime);
  }
  return runtime;
}

export class LegacyGraftRuntime {
  private status: LegacyGraftRuntimeStatus = { phase: "checking", progress: null, error: null };
  private inFlight: Promise<void> | null = null;
  private dispatch: Dispatch | null = null;

  constructor(private readonly options: { directory: string; sourceProfile: string | undefined }) {}

  async getStatus(): Promise<LegacyGraftRuntimeStatus> {
    return this.status;
  }

  start(dispatch: Dispatch): Promise<void> {
    this.dispatch = dispatch;
    if (this.inFlight) return this.inFlight;
    if (this.status.phase === "complete" || this.status.phase === "no-source")
      return Promise.resolve();
    this.inFlight = this.importHistory(dispatch).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  retry(): void {
    if (!this.dispatch) throw new Error("Graft is still starting. Try again in a moment.");
    if (this.status.phase !== "failed") return;
    void this.start(this.dispatch);
  }

  readThread(sourceThreadId: string, offset: number) {
    return readLegacyGraftThreadArchive(this.options.directory, sourceThreadId, {
      offset,
      limit: 100,
    });
  }

  private async importHistory(dispatch: Dispatch): Promise<void> {
    this.status = { phase: "importing", progress: null, error: null };
    try {
      const previous = await getLegacyGraftImportProgress(this.options.directory).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        },
      );
      this.status = { ...this.status, progress: previous };
      if (previous?.phase === "complete") {
        this.status = { phase: "complete", progress: previous, error: null };
        return;
      }
      if (!previous) {
        if (!this.options.sourceProfile) {
          this.status = { phase: "no-source", progress: null, error: null };
          return;
        }
        const sourceDbPath = join(this.options.sourceProfile, "graft-local.db");
        const source = await lstat(sourceDbPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        const savedSource = await lstat(join(this.options.directory, "source.json")).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          },
        );
        if (!source && !savedSource) {
          this.status = { phase: "no-source", progress: null, error: null };
          return;
        }
        const prepared = await prepareLegacyGraftImport({
          sourceDbPath,
          destinationDir: this.options.directory,
          allowedAttachmentRoots: [this.options.sourceProfile],
        });
        this.status = { ...this.status, progress: prepared };
      }
      await runLegacyGraftImport({
        destinationDir: this.options.directory,
        dispatch: async (command) => {
          const result = await dispatch(command);
          if (this.status.progress) {
            this.status = {
              ...this.status,
              progress: {
                ...this.status.progress,
                completedCommands: this.status.progress.completedCommands + 1,
              },
            };
          }
          return result;
        },
        registerBlockedThreads: async (threadIds) => {
          if (threadIds.some((id) => !isLegacyGraftThread(id))) {
            throw new Error("Legacy import contains an unprotected conversation identifier.");
          }
          await atomicJson(join(this.options.directory, "read-only-threads.json"), {
            version: 1,
            threadIds,
          });
        },
      });
      const progress = await getLegacyGraftImportProgress(this.options.directory);
      if (progress?.phase !== "complete") throw new Error("Legacy import did not finish.");
      this.status = { phase: "complete", progress, error: null };
    } catch (error) {
      this.status = {
        phase: "failed",
        progress: null,
        error:
          error instanceof Error
            ? error.message
            : "Graft could not import the previous app's history.",
      };
    }
  }
}
