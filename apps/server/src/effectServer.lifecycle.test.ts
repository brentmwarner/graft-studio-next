import { Effect, Scope } from "effect";
import { describe, expect, it } from "vitest";

import { closeServerRemoteAccess, closeServerRuntimePipeline } from "./effectServer.ts";

describe("server remote access shutdown", () => {
  it.each(["ssh", "lan"] as const)(
    "closes occupancy and reports the failure when %s shutdown fails",
    async (failure) => {
      const order: string[] = [];
      const cleanupFailure = new Error(`${failure} cleanup failed`);

      await expect(
        closeServerRemoteAccess({
          stopMobileRelay: () => {
            order.push("relay-stopped");
          },
          stopMobileLanGateway: async () => {
            order.push("lan-stopped");
            if (failure === "lan") throw cleanupFailure;
          },
          detachMobileLanGatewayMainServer: () => {
            order.push("lan-detached");
          },
          closeSshConnectionManager: async () => {
            order.push("ssh-stopped");
            if (failure === "ssh") throw cleanupFailure;
          },
          closeOccupancyRuntime: () => {
            order.push("occupancy-closed");
          },
        }),
      ).rejects.toBe(cleanupFailure);

      expect(order).toEqual([
        "relay-stopped",
        "lan-stopped",
        "lan-detached",
        "ssh-stopped",
        "occupancy-closed",
      ]);
    },
  );
});

describe("server runtime pipeline shutdown", () => {
  it("persists accepted provider terminal work before the engine stops", async () => {
    const order: string[] = [];
    let terminalAccepted = false;
    let terminalPersisted = false;
    let attachmentsDrained = false;
    const subscriptionsScope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(
      Scope.addFinalizer(
        subscriptionsScope,
        Effect.sync(() => {
          expect(terminalAccepted).toBe(true);
          terminalPersisted = true;
          order.push("reactors-drained-and-persisted");
        }),
      ),
    );

    await Effect.runPromise(
      closeServerRuntimePipeline({
        orchestrationEngine: {
          quiesce: Effect.sync(() => order.push("engine-quiesced")),
          drain: Effect.sync(() => order.push("admitted-commands-drained")),
          stop: Effect.sync(() => {
            expect(terminalPersisted).toBe(true);
            expect(attachmentsDrained).toBe(true);
            order.push("engine-stopped");
          }),
        },
        providerService: {
          closeRuntimeEvents: Effect.sync(() => {
            terminalAccepted = true;
            order.push("provider-terminal-events-fenced");
          }),
        },
        managedAttachmentCleanup: {
          drain: Effect.sync(() => {
            expect(terminalPersisted).toBe(true);
            attachmentsDrained = true;
            order.push("managed-attachments-drained");
          }),
        },
        subscriptionsScope,
      }),
    );

    expect(order).toEqual([
      "engine-quiesced",
      "admitted-commands-drained",
      "provider-terminal-events-fenced",
      "reactors-drained-and-persisted",
      "managed-attachments-drained",
      "engine-stopped",
    ]);
  });
});
