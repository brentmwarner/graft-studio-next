import { spawn } from "node:child_process";
import {
  SshRemoteError,
  type ResolvedSshTarget,
  type SshRemoteErrorCode,
} from "./sshRemoteTypes.js";

const SSH_TARGET_PATTERN = /^(?:[A-Za-z0-9._+-]+@)?[A-Za-z0-9._:%-]+$/u;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface SshCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type SshCommandRunner = (
  executable: string,
  arguments_: readonly string[],
  options?: { timeoutMs?: number; input?: Buffer },
) => Promise<SshCommandResult>;

export function parseSshTarget(rawTarget: string): string {
  const target = rawTarget.trim();
  if (
    target.length === 0 ||
    target.length > 255 ||
    target.startsWith("-") ||
    !SSH_TARGET_PATTERN.test(target) ||
    target.split("@").length > 2
  ) {
    throw new SshRemoteError(
      "invalid_target",
      "Enter an SSH host or user@host without command-line options",
      false,
    );
  }
  return target;
}

export const runSshCommand: SshCommandRunner = async (
  executable,
  arguments_,
  options = {},
) => {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(executable, [...arguments_], {
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, options.timeoutMs ?? 30_000);
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        rejectResult(
          new SshRemoteError(
            "ssh_unavailable",
            "The system OpenSSH client is unavailable",
            false,
          ),
        );
      } else {
        rejectResult(error);
      }
    };
    const capture = (target: Buffer[], chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += buffer.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        fail(new Error("OpenSSH output exceeded the safe limit"));
        return;
      }
      target.push(buffer);
    };
    child.stdout?.on("data", (chunk: Buffer | string) =>
      capture(stdout, chunk),
    );
    child.stderr?.on("data", (chunk: Buffer | string) =>
      capture(stderr, chunk),
    );
    child.once("error", fail);
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code ?? 255,
      });
    });
    if (options.input) child.stdin?.end(options.input);
  });
};

function parseSshConfig(stdout: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const separator = line.indexOf(" ");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).toLowerCase();
    if (!values.has(key)) values.set(key, line.slice(separator + 1).trim());
  }
  return values;
}

export function classifySshFailure(stderr: string): SshRemoteError {
  const normalized = stderr.toLowerCase();
  let code: SshRemoteErrorCode;
  let message: string;
  let retryable = false;
  if (
    normalized.includes("host key verification failed") ||
    normalized.includes("remote host identification has changed")
  ) {
    code = "host_key_verification_failed";
    message = "SSH could not verify this machine's host key";
  } else if (normalized.includes("tailnet policy does not permit")) {
    code = "ssh_access_denied";
    message = "The Tailscale SSH policy does not permit access to this account";
  } else if (
    normalized.includes("permission denied") ||
    normalized.includes("authentication failed")
  ) {
    code = "authentication_required";
    message = "SSH authentication was rejected or requires interaction";
  } else if (
    normalized.includes("could not resolve hostname") ||
    normalized.includes("name or service not known") ||
    normalized.includes("no route to host") ||
    normalized.includes("connection timed out") ||
    normalized.includes("operation timed out") ||
    normalized.includes("connection refused")
  ) {
    code = "network_unreachable";
    message = "The SSH machine could not be reached";
    retryable = true;
  } else {
    code = "bootstrap_unavailable";
    message = "The SSH machine did not start graft-host";
    retryable = true;
  }
  return new SshRemoteError(code, message, retryable);
}

export async function resolveSshTarget(
  rawTarget: string,
  options: {
    sshExecutable?: string;
    runner?: SshCommandRunner;
  } = {},
): Promise<ResolvedSshTarget> {
  const target = parseSshTarget(rawTarget);
  const runner = options.runner ?? runSshCommand;
  const result = await runner(options.sshExecutable ?? "ssh", [
    "-G",
    "--",
    target,
  ]);
  if (result.exitCode !== 0) throw classifySshFailure(result.stderr);
  const values = parseSshConfig(result.stdout);
  const hostname = values.get("hostname");
  const user = values.get("user");
  const port = Number(values.get("port"));
  if (
    !hostname ||
    !user ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new SshRemoteError(
      "invalid_target",
      "OpenSSH returned an incomplete machine configuration",
      false,
    );
  }
  const proxyJump = values.get("proxyjump");
  return {
    target,
    hostname,
    user,
    port,
    proxyJump: proxyJump && proxyJump !== "none" ? proxyJump : null,
  };
}
