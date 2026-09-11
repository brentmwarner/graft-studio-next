import { z } from "zod";
import {
  GraftDesktopCapabilityListSchema,
  GraftDesktopEnvironmentSchema,
} from "@graft/shared";
import { IPC_CHANNELS } from "../fixedChannels";
import { defineMessageContract } from "./contractDescriptor";
import { defineResponseContract } from "./responseContracts";

const fixedRendererRoute = (channel: string) =>
  ({
    direction: "renderer-to-main",
    transport: "fixed",
    channel,
  }) as const;

export const EnvironmentDescriptorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("local"),
      environmentId: z.string().min(1),
      environmentLabel: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ssh"),
      environmentId: z.string().min(1),
      environmentLabel: z.string().min(1),
      machineId: z.string().min(1),
    })
    .strict(),
]);

export const SshMachineSummarySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).max(120),
    sshTarget: z.string().min(1).max(255),
    effectiveHostname: z.string().nullable(),
    effectiveUser: z.string().nullable(),
    effectivePort: z.number().int().min(1).max(65_535).nullable(),
    environmentId: z.string().nullable(),
    environmentLabel: z.string().nullable(),
    daemonVersion: z.string().nullable(),
    protocolVersion: z.number().int().nullable(),
    capabilities: GraftDesktopCapabilityListSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    lastConnectedAt: z.number().int().nonnegative().nullable(),
    connected: z.boolean(),
  })
  .strict();

const machineResponse = defineResponseContract(SshMachineSummarySchema);

export const SSH_REMOTE_CONTRACTS = [
  defineMessageContract({
    kind: "command",
    type: "environment.getBinding",
    payload: { presence: "omitted" },
    response: defineResponseContract(EnvironmentDescriptorSchema.nullable()),
    route: fixedRendererRoute(IPC_CHANNELS.GET_ENVIRONMENT_BINDING),
  }),
  defineMessageContract({
    kind: "command",
    type: "sshMachine.list",
    payload: { presence: "omitted" },
    response: defineResponseContract(z.array(SshMachineSummarySchema)),
    route: fixedRendererRoute(IPC_CHANNELS.SSH_MACHINE_LIST),
  }),
  defineMessageContract({
    kind: "command",
    type: "sshMachine.save",
    payload: {
      presence: "required",
      schema: z
        .object({
          id: z.string().min(1).optional(),
          label: z.string().min(1).max(120),
          sshTarget: z.string().min(1).max(255),
        })
        .strict(),
    },
    response: machineResponse,
    route: fixedRendererRoute(IPC_CHANNELS.SSH_MACHINE_SAVE),
  }),
  defineMessageContract({
    kind: "command",
    type: "sshMachine.delete",
    payload: { presence: "required", schema: z.string().min(1) },
    response: defineResponseContract(
      z.object({ ok: z.literal(true) }).strict(),
    ),
    route: fixedRendererRoute(IPC_CHANNELS.SSH_MACHINE_DELETE),
  }),
  defineMessageContract({
    kind: "command",
    type: "sshMachine.connect",
    payload: { presence: "required", schema: z.string().min(1) },
    response: defineResponseContract(
      z
        .object({
          ok: z.literal(true),
          machine: SshMachineSummarySchema,
          environment: GraftDesktopEnvironmentSchema,
        })
        .strict(),
    ),
    route: fixedRendererRoute(IPC_CHANNELS.SSH_MACHINE_CONNECT),
  }),
  defineMessageContract({
    kind: "command",
    type: "sshMachine.disconnect",
    payload: { presence: "required", schema: z.string().min(1) },
    response: defineResponseContract(
      z.object({ ok: z.literal(true) }).strict(),
    ),
    route: fixedRendererRoute(IPC_CHANNELS.SSH_MACHINE_DISCONNECT),
  }),
] as const;
