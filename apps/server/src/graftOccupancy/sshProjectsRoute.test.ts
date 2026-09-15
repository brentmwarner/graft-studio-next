import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  SSH_HOST_DIRECTORY_PATH,
  SSH_HOST_PROJECTS_PATH,
  type OrchestrationShellSnapshot,
} from "@synara/contracts";
import { Effect, Exit, Layer, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, it } from "vitest";

import { ServerConfig, type ServerConfigShape } from "../config";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { ServerRuntimeStartup } from "../serverRuntimeStartup";
import { graftOccupancyRouteLayer } from "./httpRoute";
import { closeOccupancyRuntime, occupancyRuntime } from "./occupancyRuntime";

it("requires a desktop session with project grants before listing or browsing remote folders", async () => {
  const root = mkdtempSync(join(tmpdir(), "ssh-project-route-"));
  const scope = await Effect.runPromise(Scope.make("sequential"));
  const nodeServer = http.createServer();
  const config = { stateDir: root, port: 0 } as ServerConfigShape;
  const shell = { projects: [], threads: [] } as unknown as OrchestrationShellSnapshot;
  const runtime = occupancyRuntime(config, "Test host", async () => shell);
  runtime.protocol.bootstrap();
  const enroll = (grants: ("projects" | "threads")[]) =>
    runtime.store.consumeEnrollmentToken({
      token: runtime.store.issueEnrollmentToken().token,
      clientId: "test-client",
      clientLabel: "Test",
      grants,
    })!;
  const denied = enroll(["threads"]);
  const allowed = enroll(["projects"]);
  try {
    await Effect.runPromise(
      Scope.provide(
        Effect.gen(function* () {
          const server = yield* NodeHttpServer.make(() => nodeServer, {
            host: "127.0.0.1",
            port: 0,
          });
          yield* server.serve(yield* HttpRouter.toHttpEffect(graftOccupancyRouteLayer));
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              NodeServices.layer,
              Layer.succeed(ServerConfig, config),
              Layer.succeed(ServerEnvironment, {
                getDescriptor: Effect.succeed({ label: "Test host" }),
              } as never),
              Layer.succeed(ProjectionSnapshotQuery, {
                getShellSnapshot: () => Effect.succeed(shell),
              } as never),
              Layer.succeed(OrchestrationEngineService, {} as never),
              Layer.succeed(ServerRuntimeStartup, {} as never),
            ),
          ),
        ),
        scope,
      ),
    );
    const address = nodeServer.address();
    if (!address || typeof address === "string") throw new Error("Missing listener");
    const origin = `http://127.0.0.1:${address.port}`;
    for (const path of [
      SSH_HOST_PROJECTS_PATH,
      `${SSH_HOST_DIRECTORY_PATH}?path=${encodeURIComponent(`${root}/`)}`,
    ]) {
      expect((await fetch(origin + path)).status).toBe(401);
      expect(
        (await fetch(origin + path, { headers: { Authorization: `Bearer ${denied.bearer}` } }))
          .status,
      ).toBe(403);
      expect(
        (await fetch(origin + path, { headers: { Authorization: `Bearer ${allowed.bearer}` } }))
          .status,
      ).toBe(200);
    }
    runtime.store.revokeSession(allowed.session.sessionId);
    expect(
      (
        await fetch(origin + SSH_HOST_PROJECTS_PATH, {
          headers: { Authorization: `Bearer ${allowed.bearer}` },
        })
      ).status,
    ).toBe(401);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    closeOccupancyRuntime();
    rmSync(root, { recursive: true, force: true });
  }
});
