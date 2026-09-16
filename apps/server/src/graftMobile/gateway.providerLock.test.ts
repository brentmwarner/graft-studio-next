import { ThreadId } from "@graft/contracts";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it, vi } from "vitest";

import { ServerConfig } from "../config";
import { GitCore } from "../git/Services/GitCore";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { ProviderDiscoveryService } from "../provider/Services/ProviderDiscoveryService";
import { ServerSettingsService } from "../serverSettings";
import { WorkspaceEntries } from "../workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "../workspace/Services/WorkspaceFileSystem";
import { executeMobileCommand, makeGraftMobileGatewayState } from "./gateway";

// Stop at dispatch: these tests verify whether a model command is allowed to
// mutate the thread, without starting a provider or touching a user's state.
async function attempt(provider: string, started: boolean, imported = false) {
  const dispatch = vi.fn(() => Effect.fail(new Error("dispatch reached")));
  const program = executeMobileCommand(makeGraftMobileGatewayState(), "model-change", {
    type: "thread.set_model",
    threadId: "thread",
    modelId: "model",
    providerId: provider,
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(OrchestrationEngineService, { dispatch } as never),
        Layer.succeed(ProjectionSnapshotQuery, {
          getThreadShellById: () =>
            Effect.succeed(
              Option.some({
                id: ThreadId.makeUnsafe("thread"),
                modelSelection: { provider: "codex", model: "original" },
                runtimeMode: "approval-required",
                latestTurn: started ? { state: "completed" } : null,
                latestUserMessageAt: imported ? "2026-09-14T12:00:00Z" : null,
              }),
            ),
        } as never),
        Layer.succeed(ProviderDiscoveryService, {} as never),
        Layer.succeed(ServerConfig, {} as never),
        Layer.succeed(WorkspaceEntries, {} as never),
        Layer.succeed(WorkspaceFileSystem, {} as never),
        Layer.succeed(ServerEnvironment, {} as never),
        Layer.succeed(ServerSettingsService, {} as never),
        Layer.succeed(GitCore, {} as never),
      ),
    ),
    Effect.match({ onFailure: (error) => error, onSuccess: (result) => result }),
  );
  return { result: await Effect.runPromise(program), dispatch };
}

describe("mobile provider locking", () => {
  it("rejects a different provider after the first turn", async () => {
    const { result, dispatch } = await attempt("droid", true);
    expect(result).toMatchObject({
      code: "conflict",
      message:
        "This chat's provider is locked. Choose a model from the same provider or start a new chat.",
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("also locks imported history without a latest run", async () => {
    const { dispatch } = await attempt("droid", false, true);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("allows another model with the established provider", async () => {
    const { dispatch } = await attempt("codex", true);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "thread.meta.update" }));
  });
  it("allows choosing a provider before the first turn", async () => {
    const { dispatch } = await attempt("droid", false);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "thread.meta.update" }));
  });
});
