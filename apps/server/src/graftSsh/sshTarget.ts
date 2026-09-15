import { runProcess } from "../processRunner";

import { SshRemoteError, type ResolvedSshTarget, type SshRemoteErrorCode } from "./sshRemoteTypes";

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
  options?: { timeoutMs?: number; input?: Buffer; signal?: AbortSignal },
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

export const runSshCommand: SshCommandRunner = async (executable, arguments_, options = {}) => {
  try {
    const result = await runProcess(executable, arguments_, {
      timeoutMs: options.timeoutMs ?? 30_000,
      maxBufferBytes: MAX_OUTPUT_BYTES,
      allowNonZeroExit: true,
      ...(options.input ? { stdin: options.input.toString("utf8") } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (result.timedOut) {
      throw new SshRemoteError(
        "network_unreachable",
        "The SSH operation timed out. Check that the machine is awake, reachable, and connected to your network or VPN.",
        true,
      );
    }
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code ?? 255 };
  } catch (error) {
    if (error instanceof SshRemoteError) throw error;
    if (options.signal?.aborted) {
      throw new SshRemoteError("connection_closed", "SSH connection was cancelled.", false);
    }
    if (error instanceof Error && /command not found|ENOENT/iu.test(error.message)) {
      throw new SshRemoteError(
        "ssh_unavailable",
        "OpenSSH is unavailable on this computer. Install the OpenSSH client and try again.",
        false,
      );
    }
    throw new SshRemoteError(
      "bootstrap_unavailable",
      "The SSH command could not finish. Check your SSH configuration and try again.",
      true,
    );
  }
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
    message =
      "SSH could not verify this machine's identity. Connect to the same host in Terminal to review its host key, then try again.";
  } else if (normalized.includes("tailnet policy does not permit")) {
    code = "ssh_access_denied";
    message =
      "Tailscale does not permit SSH access to this account. Check the remote username and your tailnet SSH access policy.";
  } else if (
    normalized.includes("permission denied") ||
    normalized.includes("authentication failed")
  ) {
    code = "authentication_required";
    message =
      "SSH authentication failed. Check the remote username and load your SSH key into the agent. Password prompts are not supported; verify that the same user@host works in Terminal.";
  } else if (
    normalized.includes("could not resolve hostname") ||
    normalized.includes("name or service not known") ||
    normalized.includes("no route to host") ||
    normalized.includes("connection timed out") ||
    normalized.includes("operation timed out") ||
    normalized.includes("connection refused")
  ) {
    code = "network_unreachable";
    message =
      "The machine could not be reached over SSH. Check its address, make sure it is awake, and connect both computers to the same network or VPN.";
    retryable = true;
  } else if (/node.*(?:not found|no such file)|requires Node\.js/iu.test(stderr)) {
    code = "install_failed";
    message =
      "The remote machine needs Node.js 22.19+, 23.11+, 24.10+, or a newer supported release, available to SSH commands.";
  } else if (normalized.includes("unsupported") && /platform|linux|glibc/iu.test(stderr)) {
    code = "incompatible_host";
    message =
      "This remote host requires Linux x64 with glibc. This machine's operating system or architecture is not supported.";
  } else {
    code = "bootstrap_unavailable";
    message =
      "SSH connected, but the remote host service could not start. Check Node.js on the remote machine and run graft-host diagnostics --json there.";
    retryable = true;
  }
  return new SshRemoteError(code, message, retryable);
}

export async function resolveSshTarget(
  rawTarget: string,
  options: {
    sshExecutable?: string;
    runner?: SshCommandRunner;
    signal?: AbortSignal;
  } = {},
): Promise<ResolvedSshTarget> {
  const target = parseSshTarget(rawTarget);
  const runner = options.runner ?? runSshCommand;
  const result = await runner(options.sshExecutable ?? "ssh", ["-G", "--", target], {
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (result.exitCode !== 0) throw classifySshFailure(result.stderr);
  const values = parseSshConfig(result.stdout);
  const hostname = values.get("hostname");
  const user = values.get("user");
  const port = Number(values.get("port"));
  if (!hostname || !user || !Number.isInteger(port) || port < 1 || port > 65_535) {
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
