import { describe, expect, it, vi } from "vitest";
import {
  classifySshFailure,
  parseSshTarget,
  resolveSshTarget,
} from "./sshTarget.js";

describe("SSH target resolution", () => {
  it("accepts aliases and user@host targets but rejects option injection", () => {
    expect(parseSshTarget(" fedora ")).toBe("fedora");
    expect(parseSshTarget("brent@dev.example.com")).toBe(
      "brent@dev.example.com",
    );
    for (const invalid of [
      "-oProxyCommand=bad",
      "host command",
      "ssh://host",
      "user@host@other",
      "",
    ]) {
      expect(() => parseSshTarget(invalid)).toThrow(/SSH host|user@host/);
    }
  });

  it("uses system ssh -G so aliases, users, ports, and ProxyJump stay authoritative", async () => {
    const runner = vi.fn(async () => ({
      exitCode: 0,
      stderr: "",
      stdout: [
        "host fedora",
        "hostname fedora.tail.example",
        "user brent",
        "port 2222",
        "proxyjump bastion",
      ].join("\n"),
    }));
    await expect(resolveSshTarget("fedora", { runner })).resolves.toEqual({
      target: "fedora",
      hostname: "fedora.tail.example",
      user: "brent",
      port: 2222,
      proxyJump: "bastion",
    });
    expect(runner).toHaveBeenCalledWith("ssh", ["-G", "--", "fedora"]);
  });

  it("classifies host key, interactive auth, Tailscale policy, and reachability errors", () => {
    expect(classifySshFailure("Host key verification failed").code).toBe(
      "host_key_verification_failed",
    );
    expect(classifySshFailure("Permission denied (publickey)").code).toBe(
      "authentication_required",
    );
    expect(
      classifySshFailure("tailnet policy does not permit you to SSH").code,
    ).toBe("ssh_access_denied");
    expect(classifySshFailure("Connection timed out")).toMatchObject({
      code: "network_unreachable",
      retryable: true,
    });
  });
});
