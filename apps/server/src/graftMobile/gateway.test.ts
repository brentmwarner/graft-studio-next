import { GraftMobileCommandSchema } from "@graft/mobile-contract";
import { Effect, Layer, Option } from "effect";
import { expect, it, vi } from "vitest";

import { CheckpointDiffQuery } from "../checkpointing/Services/CheckpointDiffQuery";
import { ServerConfig } from "../config";
import { GitCore } from "../git/Services/GitCore";
import { WorkspaceEntries } from "../workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "../workspace/Services/WorkspaceFileSystem";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment";
import { attachmentPrincipalForSession } from "../managedAttachmentPrincipal";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { ProviderDiscoveryService } from "../provider/Services/ProviderDiscoveryService";
import { ServerSettingsService } from "../serverSettings";
import { executeMobileCommand, makeGraftMobileGatewayState } from "./gateway";

it("dispatches mobile attachments with the authenticated session and real interaction mode", async () => {
  const attachment = {
    id: "upload-1",
    type: "file",
    name: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 10,
  };
  const current = {
    id: "thread-1",
    projectId: "project-1",
    title: "Test",
    modelSelection: { provider: "codex", model: "gpt-5", options: { reasoningEffort: "high" } },
    interactionMode: "debug",
    runtimeMode: "approval-required",
    latestTurn: { turnId: "turn-1", state: "running", requestedAt: "2026-09-15T00:00:00Z" },
  };
  const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));
  const layer = Layer.mergeAll(
    Layer.succeed(OrchestrationEngineService, { dispatch } as never),
    Layer.succeed(ProjectionSnapshotQuery, {
      getThreadShellById: () => Effect.succeed(Option.some(current)),
      getShellSnapshot: () => Effect.succeed({ snapshotSequence: 1, threads: [current] }),
    } as never),
    // These command branches do not use the remaining gateway services.
    Layer.succeed(CheckpointDiffQuery, {} as never),
    Layer.succeed(ServerConfig, {} as never),
    Layer.succeed(GitCore, {} as never),
    Layer.succeed(WorkspaceEntries, {} as never),
    Layer.succeed(WorkspaceFileSystem, {} as never),
    Layer.succeed(ServerEnvironment, {} as never),
    Layer.succeed(ProviderDiscoveryService, {} as never),
    Layer.succeed(ServerSettingsService, {} as never),
  );
  const context = { attachmentPrincipal: attachmentPrincipalForSession("paired-phone") };
  for (const additions of [
    { attachments: [attachment], interactionMode: "plan", fastMode: true },
    {},
  ]) {
    const command = GraftMobileCommandSchema.parse({
      type: "turn.start",
      threadId: "thread-1",
      text: "Review",
      ...additions,
    });
    await Effect.runPromise(
      executeMobileCommand(makeGraftMobileGatewayState(), "mobile-command", command, context).pipe(
        Effect.provide(layer),
      ),
    );
  }
  expect(dispatch.mock.calls[0]).toEqual([
    expect.objectContaining({
      type: "thread.turn.start",
      interactionMode: "plan",
      runtimeMode: "approval-required",
      message: expect.objectContaining({ text: "Review", attachments: [attachment] }),
      modelSelection: {
        provider: "codex",
        model: "gpt-5",
        options: { reasoningEffort: "high", fastMode: true },
      },
    }),
    context,
  ]);
  expect(dispatch.mock.calls[1]).toEqual([
    expect.objectContaining({
      interactionMode: "debug",
      message: expect.objectContaining({ attachments: [] }),
      modelSelection: current.modelSelection,
    }),
    context,
  ]);
});
