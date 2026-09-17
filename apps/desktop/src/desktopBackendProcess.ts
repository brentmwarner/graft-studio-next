import { EventEmitter } from "node:events";

import type { UtilityProcess } from "electron";

import type { BackendShutdownProcess } from "./backendShutdown";

export interface DesktopBackendProcess extends BackendShutdownProcess {
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  pid: number | undefined;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

/** Adapts Electron's supported Node utility process to the desktop supervisor contract. */
export class UtilityDesktopBackendProcess extends EventEmitter implements DesktopBackendProcess {
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  pid: number | undefined;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  constructor(private readonly utility: UtilityProcess) {
    super();
    this.stdout = utility.stdout;
    this.stderr = utility.stderr;
    this.pid = utility.pid;
    utility.on("spawn", () => {
      this.pid = utility.pid;
    });
    utility.on("error", (type, location, report) => {
      const detail = [type, location, report].filter(Boolean).join(": ");
      this.emit("error", new Error(`Backend utility process failed: ${detail}`));
    });
    utility.on("exit", (code) => {
      this.exitCode = code;
      this.pid = undefined;
      this.emit("exit", code, null);
    });
  }

  kill(signal: number | NodeJS.Signals = "SIGTERM"): boolean {
    if (signal === "SIGKILL" && this.pid !== undefined) {
      try {
        process.kill(this.pid, signal);
        return true;
      } catch {
        return false;
      }
    }
    return this.utility.kill();
  }
}
