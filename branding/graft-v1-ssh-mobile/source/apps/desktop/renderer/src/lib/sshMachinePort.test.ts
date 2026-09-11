import { beforeEach, describe, expect, it, vi } from "vitest";
import { sshMachinePort } from "./sshMachinePort";

describe("sshMachinePort", () => {
  const sshMachineConnect = vi.fn();
  const sshMachineDisconnect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "electronBridge", {
      configurable: true,
      value: { sshMachineConnect, sshMachineDisconnect },
    });
  });

  it("connects a machine without activating a different app environment", async () => {
    const machine = { id: "machine-fedora", label: "Fedora" };
    const environment = {
      environmentId: "environment-fedora",
      environmentLabel: "Fedora",
      cursor: 0,
      snapshot: {},
    };
    sshMachineConnect.mockResolvedValue({ ok: true, machine, environment });

    await expect(sshMachinePort.connect("machine-fedora")).resolves.toEqual({
      machine,
      environment,
    });

    expect(sshMachineConnect).toHaveBeenCalledExactlyOnceWith("machine-fedora");
  });

  it("disconnects a machine without changing the current project", async () => {
    sshMachineDisconnect.mockResolvedValue({ ok: true });

    await expect(
      sshMachinePort.disconnect("machine-fedora"),
    ).resolves.toBeUndefined();
    expect(sshMachineDisconnect).toHaveBeenCalledExactlyOnceWith(
      "machine-fedora",
    );
  });
});
