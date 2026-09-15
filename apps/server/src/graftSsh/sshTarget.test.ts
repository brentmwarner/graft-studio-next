import { describe, expect, it } from "vitest";

import { classifySshFailure, runSshCommand } from "./sshTarget";

describe("SSH command execution", () => {
  it("drains all output before returning an exited process", async () => {
    const result = await runSshCommand(process.execPath, [
      "-e",
      'process.stdout.write("x".repeat(256 * 1024)); process.stderr.write("last diagnostic");',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toHaveLength(256 * 1024);
    expect(result.stderr).toBe("last diagnostic");
  });

  it("reports a timeout instead of pretending the host failed to bootstrap", async () => {
    await expect(
      runSshCommand(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { timeoutMs: 40 }),
    ).rejects.toMatchObject({ code: "network_unreachable", retryable: true });
  });

  it("reports a missing local OpenSSH executable", async () => {
    await expect(runSshCommand("/nonexistent/synara-test-ssh", [])).rejects.toMatchObject({
      code: "ssh_unavailable",
      retryable: false,
    });
  });

  it("cancels an in-flight command", async () => {
    const controller = new AbortController();
    const operation = runSshCommand(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      signal: controller.signal,
    });
    controller.abort();
    await expect(operation).rejects.toMatchObject({ code: "connection_closed" });
  });
});

describe("SSH failure guidance", () => {
  it.each([
    ["Permission denied (publickey)", "authentication_required", "username"],
    ["Host key verification failed", "host_key_verification_failed", "Terminal"],
    ["ssh: connect to host example port 22: Operation timed out", "network_unreachable", "VPN"],
    ["tailnet policy does not permit you to SSH", "ssh_access_denied", "policy"],
    ["env: node: No such file or directory", "install_failed", "Node.js"],
    ["GRAFT_HOST_UNSUPPORTED_PLATFORM", "incompatible_host", "Linux"],
  ])("explains %s", (stderr, code, guidance) => {
    const failure = classifySshFailure(stderr!);
    expect(failure.code).toBe(code);
    expect(failure.message).toContain(guidance!);
  });
});
