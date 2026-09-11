import type { GraftDesktopEnvironment } from "@graft/shared";
import type { SshMachineSummary } from "../../../electron/src/services/sshRemote";

export type { SshMachineSummary };

export const sshMachinePort = {
  async list(): Promise<SshMachineSummary[]> {
    const list = await window.electronBridge?.sshMachineList?.();
    return list ?? [];
  },

  async save(input: {
    id?: string;
    label: string;
    sshTarget: string;
  }): Promise<SshMachineSummary> {
    const machine = await window.electronBridge?.sshMachineSave?.(input);
    if (!machine) throw new Error("SSH machine bridge unavailable");
    return machine;
  },

  async delete(machineId: string): Promise<void> {
    const result = await window.electronBridge?.sshMachineDelete?.(machineId);
    if (!result?.ok) throw new Error("SSH machine could not be removed");
  },

  async connect(machineId: string): Promise<{
    machine: SshMachineSummary;
    environment: GraftDesktopEnvironment;
  }> {
    const result = await window.electronBridge?.sshMachineConnect?.(machineId);
    if (!result?.ok) throw new Error("SSH machine could not be connected");
    return { machine: result.machine, environment: result.environment };
  },

  async disconnect(machineId: string): Promise<void> {
    const result =
      await window.electronBridge?.sshMachineDisconnect?.(machineId);
    if (!result?.ok) throw new Error("SSH machine could not be disconnected");
  },
};
