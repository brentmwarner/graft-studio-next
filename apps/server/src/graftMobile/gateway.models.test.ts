import type { GraftMobileCommand } from "@graft/mobile-contract";
import {
  MODEL_OPTIONS_BY_PROVIDER,
  ProjectId,
  ThreadId,
  type ModelSelection,
  type ProviderKind,
} from "@graft/contracts";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it, vi } from "vitest";

import { ServerConfig } from "../config";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment";
import { GitCore } from "../git/Services/GitCore";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { ProviderDiscoveryService } from "../provider/Services/ProviderDiscoveryService";
import { ServerSettingsService } from "../serverSettings";
import { WorkspaceEntries } from "../workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "../workspace/Services/WorkspaceFileSystem";
import { executeMobileCommand, makeGraftMobileGatewayState } from "./gateway";
import { MOBILE_PROVIDER_ORDER } from "./protocolAdapter";

function harness(stallProvider?: ProviderKind) {
  const thread = {
    id: ThreadId.makeUnsafe("thread"),
    projectId: ProjectId.makeUnsafe("project"),
    title: "Model test",
    updatedAt: "2026-09-15T12:00:00Z",
    envMode: "local",
    modelSelection: { provider: "codex", model: "gpt-5.5" } as ModelSelection,
    runtimeMode: "approval-required",
    interactionMode: "default",
    latestTurn: null,
  };
  const dispatch = vi.fn((command: { type: string; modelSelection?: ModelSelection }) => {
    if (command.modelSelection) thread.modelSelection = command.modelSelection;
    return command.type === "thread.turn.start"
      ? Effect.fail(new Error("turn dispatch captured"))
      : Effect.succeed({ sequence: 1 });
  });
  const listModels = vi.fn(({ provider }: { provider: ProviderKind }) =>
    provider === stallProvider
      ? Effect.never
      : Effect.succeed({
          models: [
            {
              slug: "runtime-preview",
              name: "Runtime preview",
              supportedReasoningEfforts: [{ value: "max" }],
              defaultReasoningEffort: "max",
            },
          ],
        }),
  );
  const services = Layer.mergeAll(
    Layer.succeed(OrchestrationEngineService, { dispatch } as never),
    Layer.succeed(ProjectionSnapshotQuery, {
      getThreadShellById: () => Effect.succeed(Option.some(thread)),
      getShellSnapshot: () => Effect.succeed({ snapshotSequence: 1, threads: [thread] }),
    } as never),
    Layer.succeed(ProviderDiscoveryService, { listModels } as never),
    Layer.succeed(ServerConfig, { cwd: "/workspace/repo" } as never),
    Layer.succeed(WorkspaceEntries, {} as never),
    Layer.succeed(WorkspaceFileSystem, {} as never),
    Layer.succeed(ServerEnvironment, {} as never),
    Layer.succeed(ServerSettingsService, {
      getSettings: Effect.succeed({
        providers: Object.fromEntries(
          MOBILE_PROVIDER_ORDER.map((provider) => [
            provider,
            {
              enabled: provider === "codex" || provider === "droid" || provider === stallProvider,
              binaryPath: "",
            },
          ]),
        ),
      }),
    } as never),
    Layer.succeed(GitCore, {} as never),
  );
  return {
    thread,
    dispatch,
    listModels,
    run: (command: GraftMobileCommand) =>
      Effect.runPromise(
        executeMobileCommand(makeGraftMobileGatewayState(), "test-model-command", command).pipe(
          Effect.provide(services),
          Effect.timeout("6 seconds"),
        ),
      ),
  };
}

describe("mobile model settings", () => {
  it("keeps Droid available without starting discovery on mobile catalog loads or reconnects", async () => {
    const test = harness();
    for (let request = 0; request < 2; request += 1) {
      const result = await test.run({ type: "models.list" });
      expect(test.listModels).not.toHaveBeenCalledWith(
        expect.objectContaining({ provider: "droid" }),
      );
      expect(result).toMatchObject({ type: "models.list.result" });
      if (result.type !== "models.list.result") throw new Error("Expected model catalog");
      expect(
        result.models.filter((model) => model.providerId === "droid").map((model) => model.id),
      ).toEqual(MODEL_OPTIONS_BY_PROVIDER.droid.map((model) => model.slug));
      expect(result.models).toContainEqual(
        expect.objectContaining({ providerId: "codex", id: "runtime-preview" }),
      );
    }
    expect(test.listModels.mock.calls.map(([input]) => input.provider)).toEqual(["codex", "codex"]);
  });

  it("returns healthy and built-in models when another provider discovery stalls", async () => {
    const test = harness("grok");
    const result = await test.run({ type: "models.list" });
    expect(result).toMatchObject({
      type: "models.list.result",
      models: expect.arrayContaining([
        expect.objectContaining({
          providerId: "codex",
          id: "runtime-preview",
          reasoningEfforts: ["max"],
          defaultReasoningEffort: "max",
        }),
        expect.objectContaining({ providerId: "droid" }),
        expect.objectContaining({ providerId: "grok" }),
      ]),
    });
  }, 10_000);

  it("returns the confirmed model from the updated projection", async () => {
    const test = harness();
    const result = await test.run({
      type: "thread.set_model",
      threadId: "thread",
      modelId: "runtime-preview",
      providerId: "codex",
    });
    expect(result).toMatchObject({
      type: "thread.set_model.result",
      thread: {
        id: "thread",
        modelName: "runtime-preview",
        providerId: "codex",
      },
    });
  });

  it("passes intelligence and explicit Standard speed to the next turn", async () => {
    const test = harness();
    test.thread.modelSelection = {
      provider: "codex",
      model: "gpt-5.5",
      options: { fastMode: true },
    };
    await expect(
      test.run({
        type: "turn.start",
        threadId: "thread",
        text: "Continue",
        effort: "max",
        fastMode: false,
      }),
    ).rejects.toThrow("turn dispatch captured");
    expect(test.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.turn.start",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.5",
          options: { reasoningEffort: "max", fastMode: false },
        },
      }),
      undefined,
    );
  });
});
