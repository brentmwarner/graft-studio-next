import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveServerEnvironmentLabel } from "./ServerEnvironmentLabel";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("@graft/shared/processRuntime", () => ({ spawnProcessSync: spawn }));
function result(stdout: string, status = 0) {
  return { stdout, status };
}
beforeEach(() => {
  spawn.mockReset().mockReturnValue(result("", 1));
});

describe("resolveServerEnvironmentLabel", () => {
  it("uses an explicit machine name without probing the OS", () => {
    expect(resolveServerEnvironmentLabel({ env: { GRAFT_MACHINE_NAME: " MacBook Pro " } })).toBe(
      "MacBook Pro",
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it("reads the Linux hostname even when the desktop has no HOSTNAME environment variable", () => {
    spawn.mockReturnValue(result("omarchy\n"));
    expect(
      resolveServerEnvironmentLabel({ platform: "linux", env: { USER: "brentmwarner" } }),
    ).toBe("omarchy");
    expect(spawn).toHaveBeenCalledWith(
      "/bin/hostname",
      [],
      expect.objectContaining({ timeout: 1_000, maxBuffer: 4_096 }),
    );
  });

  it("prefers the friendly macOS computer name to a shell hostname", () => {
    spawn.mockReturnValue(result("MacBook Pro\n"));
    expect(
      resolveServerEnvironmentLabel({ platform: "darwin", env: { HOSTNAME: "MacBook-Pro.local" } }),
    ).toBe("MacBook Pro");
    expect(spawn).toHaveBeenCalledWith(
      "/usr/sbin/scutil",
      ["--get", "ComputerName"],
      expect.anything(),
    );
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("falls back to the hostname when the macOS computer name is unavailable", () => {
    spawn.mockReturnValueOnce(result("", 1)).mockReturnValueOnce(result("MacBook-Pro.local\n"));
    expect(resolveServerEnvironmentLabel({ platform: "darwin", env: {} })).toBe(
      "MacBook-Pro.local",
    );
  });

  it("uses COMPUTERNAME on Windows without launching POSIX commands", () => {
    expect(
      resolveServerEnvironmentLabel({ platform: "win32", env: { COMPUTERNAME: " Office PC " } }),
    ).toBe("Office PC");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("keeps startup working when a probe fails and never uses the username", () => {
    spawn.mockImplementation(() => {
      throw new Error("probe unavailable");
    });
    expect(
      resolveServerEnvironmentLabel({ platform: "linux", env: { HOSTNAME: " omarchy " } }),
    ).toBe("omarchy");
    expect(
      resolveServerEnvironmentLabel({ platform: "darwin", env: { USER: "brentwarner" } }),
    ).toBe("Graft");
  });

  it("ignores blank names and failed-command output", () => {
    spawn.mockReturnValue(result("not a hostname", 1));
    expect(
      resolveServerEnvironmentLabel({
        platform: "linux",
        env: { GRAFT_MACHINE_NAME: " ", HOSTNAME: "omarchy" },
      }),
    ).toBe("omarchy");
    spawn.mockReturnValue(result(" \n"));
    expect(resolveServerEnvironmentLabel({ platform: "linux", env: {} })).toBe("Graft");
  });
});
