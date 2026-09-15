import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  SSH_HOST_DIRECTORY_PATH,
  SSH_HOST_PROJECTS_PATH,
  SshProjectAddResult,
  type OrchestrationShellSnapshot,
} from "@synara/contracts";
import { Effect, Exit, Layer, Schema, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterEach, expect, it, vi } from "vitest";

import { ServerConfig, type ServerConfigShape } from "../config";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../orchestration/Services/ProjectionSnapshotQuery";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../orchestration/Services/OrchestrationEngine";
import {
  ServerRuntimeStartup,
  ServerRuntimeStartupError,
  type ServerRuntimeStartupShape,
} from "../serverRuntimeStartup";
import { OrchestrationCommandInvariantError } from "../orchestration/Errors";
import { PersistenceSqlError } from "../persistence/Errors";
import { decideOrchestrationCommand } from "../orchestration/decider";
import { createEmptyReadModel, projectEvent } from "../orchestration/projector";
import { graftOccupancyRouteLayer } from "./httpRoute";
import { closeOccupancyRuntime, occupancyRuntime } from "./occupancyRuntime";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function startHost() {
  const root = mkdtempSync(join(tmpdir(), "ssh-project-route-"));
  const scope = await Effect.runPromise(Scope.make("sequential"));
  const nodeServer = http.createServer();
  const config = { stateDir: root, port: 0 } as ServerConfigShape;
  const shell = { projects: [], threads: [] } as unknown as OrchestrationShellSnapshot;
  const runtime = occupancyRuntime(config, "Test host", async () => shell);
  cleanups.push(async () => {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    closeOccupancyRuntime();
    rmSync(root, { recursive: true, force: true });
  });
  let model = createEmptyReadModel(new Date().toISOString());
  let sequence = 0;
  const engine = {
    getReadModel: vi.fn<OrchestrationEngineShape["getReadModel"]>(() => Effect.succeed(model)),
    dispatch: vi.fn<OrchestrationEngineShape["dispatch"]>((command) =>
      Effect.gen(function* () {
        const result = yield* decideOrchestrationCommand({ command, readModel: model });
        for (const event of Array.isArray(result) ? result : [result]) {
          model = yield* projectEvent(model, { ...event, sequence: ++sequence });
        }
        return { sequence };
      }),
    ),
  };
  const query = {
    getShellSnapshot: vi.fn<ProjectionSnapshotQueryShape["getShellSnapshot"]>(() =>
      Effect.succeed(shell),
    ),
  };
  const startup = {
    enqueueCommand: vi.fn<ServerRuntimeStartupShape["enqueueCommand"]>((effect) => effect),
  };
  runtime.protocol.bootstrap();
  const enroll = (grants: ("projects" | "threads")[]) =>
    runtime.store.consumeEnrollmentToken({
      token: runtime.store.issueEnrollmentToken().token,
      clientId: "test-client",
      clientLabel: "Test",
      grants,
    })!;
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
            Layer.succeed(ProjectionSnapshotQuery, query as never),
            Layer.succeed(OrchestrationEngineService, engine as never),
            Layer.succeed(ServerRuntimeStartup, startup as never),
          ),
        ),
      ),
      scope,
    ),
  );
  const address = nodeServer.address();
  if (!address || typeof address === "string") throw new Error("Missing listener");
  const origin = `http://127.0.0.1:${address.port}`;
  const allowed = enroll(["projects"]);
  const headers = { Authorization: `Bearer ${allowed.bearer}` };
  const add = (body: unknown) =>
    fetch(origin + SSH_HOST_PROJECTS_PATH, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { root, origin, runtime, enroll, allowed, headers, add, engine, query, startup };
}

it("requires a desktop session with project grants before listing or browsing remote folders", async () => {
  const { root, origin, runtime, enroll, allowed } = await startHost();
  const denied = enroll(["threads"]);
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
});

it("keeps invalid JSON, schemas, and folder paths as bad requests", async () => {
  const host = await startHost();
  const file = join(host.root, "file");
  writeFileSync(file, "test");
  const malformed = await fetch(host.origin + SSH_HOST_PROJECTS_PATH, {
    method: "POST",
    headers: { ...host.headers, "Content-Type": "application/json" },
    body: "{",
  });
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toEqual({ error: "Invalid JSON payload." });
  for (const body of [
    {},
    { commandId: "add", projectId: "project", path: "relative" },
    { commandId: "add", projectId: "project", path: join(host.root, "missing") },
    { commandId: "add", projectId: "project", path: file },
  ]) {
    expect((await host.add(body)).status).toBe(400);
  }
  for (const path of ["../", join(host.root, "missing/"), "x".repeat(513)]) {
    const response = await fetch(
      `${host.origin}${SSH_HOST_DIRECTORY_PATH}?path=${encodeURIComponent(path)}`,
      { headers: host.headers },
    );
    expect(response.status).toBe(400);
  }
  expect(host.engine.dispatch).not.toHaveBeenCalled();
});

it("requires absolute or home paths when browsing remote folders", async () => {
  const host = await startHost();
  const invalidPaths = ["secrets", "secrets/", "~someone", ".", "..", "./secrets", "../secrets"];
  if (process.platform !== "win32") {
    invalidPaths.push("C:\\workspace", "C:/workspace", "\\\\server\\share");
  }
  for (const path of invalidPaths) {
    const response = await fetch(
      `${host.origin}${SSH_HOST_DIRECTORY_PATH}?path=${encodeURIComponent(path)}`,
      { headers: host.headers },
    );
    expect(response.status, path).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose an absolute folder path on the remote computer.",
    });
  }
  for (const [path, parentPath] of [
    [`${host.root}/`, host.root],
    ["~", homedir()],
    ["~/", homedir()],
    ["~\\", homedir()],
  ] as const) {
    const response = await fetch(
      `${host.origin}${SSH_HOST_DIRECTORY_PATH}?path=${encodeURIComponent(path)}`,
      { headers: host.headers },
    );
    expect(response.status, path).toBe(200);
    expect(await response.json()).toMatchObject({ parentPath });
  }
});

it("returns server errors for projection, read model, dispatch, and startup failures", async () => {
  const host = await startHost();
  const input = { commandId: "add", projectId: "project", path: host.root };
  const databaseError = new PersistenceSqlError({
    operation: "test",
    detail: "Database unavailable",
  });
  host.query.getShellSnapshot.mockReturnValueOnce(Effect.fail(databaseError));
  expect(
    (await fetch(host.origin + SSH_HOST_PROJECTS_PATH, { headers: host.headers })).status,
  ).toBe(500);
  host.engine.getReadModel.mockReturnValueOnce(Effect.die(new Error("Read model unavailable")));
  const readModelFailure = await host.add(input);
  expect(readModelFailure.status).toBe(500);
  expect(await readModelFailure.json()).toEqual({ error: "Read model unavailable" });
  host.engine.dispatch.mockReturnValueOnce(Effect.fail(databaseError));
  const dispatchFailure = await host.add(input);
  expect(dispatchFailure.status).toBe(500);
  expect(await dispatchFailure.json()).toEqual({ error: databaseError.message });
  host.startup.enqueueCommand.mockImplementationOnce(() =>
    Effect.fail(new ServerRuntimeStartupError({ message: "Startup failed" })),
  );
  const startupFailure = await host.add(input);
  expect(startupFailure.status).toBe(503);
  expect(await startupFailure.json()).toEqual({ error: "Startup failed" });
  host.engine.dispatch.mockReturnValueOnce(
    Effect.fail(
      new OrchestrationCommandInvariantError({
        commandType: "project.create",
        detail: "Project is invalid",
      }),
    ),
  );
  expect((await host.add(input)).status).toBe(400);
  expect((await host.add(input)).status).toBe(200);
});

it("shares folder registration across HTTP requests while commands wait for startup", async () => {
  const host = await startHost();
  const commandStarted = Promise.withResolvers<void>();
  const releaseCommand = Promise.withResolvers<void>();
  host.startup.enqueueCommand.mockImplementation((effect) => {
    commandStarted.resolve();
    return Effect.promise(() => releaseCommand.promise).pipe(Effect.andThen(effect));
  });
  const requests = Array.from({ length: 8 }, (_, index) =>
    host.add({
      commandId: `add-${index}`,
      projectId: `project-${index}`,
      path: host.root,
    }),
  );
  await commandStarted.promise;
  // A completed browse request confirms the host keeps serving while registration is queued.
  const directory = await fetch(
    `${host.origin}${SSH_HOST_DIRECTORY_PATH}?path=${encodeURIComponent(`${host.root}/`)}`,
    { headers: host.headers },
  );
  expect(directory.status).toBe(200);
  releaseCommand.resolve();
  const responses = await Promise.all(requests);
  const projects = await Promise.all(
    responses.map(async (response) => {
      expect(response.status).toBe(200);
      return Schema.decodeUnknownSync(SshProjectAddResult)(await response.json());
    }),
  );
  expect(new Set(projects.map(({ project }) => project.id)).size).toBe(1);
  expect(host.engine.dispatch).toHaveBeenCalledOnce();
  expect(host.startup.enqueueCommand).toHaveBeenCalledOnce();
});
