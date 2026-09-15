import {
  GRAFT_DESKTOP_ENDPOINTS,
  GRAFT_DESKTOP_PROTOCOL_VERSION,
  GRAFT_HOST_SERVICE,
  GRAFT_HOST_VERSION,
  GraftDesktopHealthSchema,
} from "@graft/desktop-contract";
import {
  HEADLESS_HOST_CAPABILITIES,
  LINUX_X64_GLIBC_PLATFORM,
  type OccupancyConnection,
} from "@graft/occupancy";
import {
  FilesystemBrowseInput,
  SSH_HOST_DIRECTORY_PATH,
  SSH_HOST_PROJECTS_PATH,
  SshProjectAddInput,
} from "@synara/contracts";
import { Effect, FileSystem, Layer, Queue, Schema, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerConfig } from "../config";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { browseWorkspaceEntries } from "../workspaceEntries";
import { ServerRuntimeStartup } from "../serverRuntimeStartup";
import { addSshProject } from "./sshProjects";
import {
  closeOccupancyRuntime,
  getOccupancyListenPort,
  occupancyRuntime,
  type OccupancyRuntime,
} from "./occupancyRuntime";

const OCCUPANCY_JSON_BODY_MAX_BYTES = 256 * 1024;

export function parseOccupancyBearer(authorization: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const bearer = authorization.slice("Bearer ".length).trim();
  return bearer.length > 0 ? bearer : null;
}

export function occupancyHealthJson(runtime: OccupancyRuntime, port: number) {
  const health = runtime.protocol.health();
  return GraftDesktopHealthSchema.parse({
    service: GRAFT_HOST_SERVICE,
    protocolVersion: GRAFT_DESKTOP_PROTOCOL_VERSION,
    daemonVersion: GRAFT_HOST_VERSION,
    environmentId: health.identity.environmentId,
    environmentLabel: health.identity.environmentLabel,
    platform: LINUX_X64_GLIBC_PLATFORM,
    port,
    capabilities: [...HEADLESS_HOST_CAPABILITIES],
    cursor: health.replay.cursor,
    replayFloor: health.replay.replayFloor,
    ...health.activity,
  });
}

function jsonResponse(value: unknown, status = 200) {
  return HttpServerResponse.jsonUnsafe(value, { status });
}

const readJson = (request: HttpServerRequest.HttpServerRequest) => {
  const declaredLength = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > OCCUPANCY_JSON_BODY_MAX_BYTES) {
    return Effect.fail(new Error("Request body too large."));
  }
  return request.json.pipe(
    Effect.provideService(
      HttpServerRequest.MaxBodySize,
      FileSystem.Size(OCCUPANCY_JSON_BODY_MAX_BYTES),
    ),
    Effect.mapError(() => new Error("Invalid JSON payload.")),
  );
};

function decodeSocketMessage(message: unknown): unknown {
  if (typeof message === "string") {
    try {
      return JSON.parse(message);
    } catch {
      return null;
    }
  }
  if (message instanceof Uint8Array) {
    try {
      return JSON.parse(new TextDecoder().decode(message));
    } catch {
      return null;
    }
  }
  return null;
}

const occupancyHttpRouteLayer = HttpRouter.add(
  "*",
  "/desktop/v1/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return jsonResponse({ error: "Bad request" }, 400);

    const config = yield* ServerConfig;
    const environment = yield* ServerEnvironment;
    const query = yield* ProjectionSnapshotQuery;
    const descriptor = yield* environment.getDescriptor;
    const occupancy = occupancyRuntime(config, descriptor.label, () =>
      Effect.runPromise(query.getShellSnapshot()),
    );
    const port = getOccupancyListenPort() || config.port;

    if (request.method === "GET" && url.pathname === GRAFT_DESKTOP_ENDPOINTS.health) {
      return jsonResponse(occupancyHealthJson(occupancy, port));
    }

    if (request.method === "POST" && url.pathname === GRAFT_DESKTOP_ENDPOINTS.enroll) {
      const body = yield* readJson(request).pipe(Effect.catch(() => Effect.succeed(null)));
      if (body === null) return jsonResponse({ error: "Invalid enrollment request" }, 400);
      try {
        const enrolled = occupancy.protocol.enroll(body);
        if (!enrolled) {
          return jsonResponse(
            { error: "Enrollment token is invalid, expired, or already used" },
            401,
          );
        }
        return jsonResponse(enrolled);
      } catch {
        return jsonResponse({ error: "Invalid enrollment request" }, 400);
      }
    }

    if (request.method === "DELETE" && url.pathname === GRAFT_DESKTOP_ENDPOINTS.session) {
      const bearer = parseOccupancyBearer(request.headers.authorization);
      const session = bearer ? occupancy.store.authenticateBearer(bearer) : null;
      if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
      occupancy.store.revokeSession(session.sessionId);
      return jsonResponse({ ok: true });
    }

    if (url.pathname === SSH_HOST_PROJECTS_PATH || url.pathname === SSH_HOST_DIRECTORY_PATH) {
      const bearer = parseOccupancyBearer(request.headers.authorization);
      const session = bearer ? occupancy.store.authenticateBearer(bearer) : null;
      if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
      if (!session.grants.includes("projects"))
        return jsonResponse({ error: "Project access is not allowed." }, 403);
      return yield* Effect.gen(function* () {
        if (request.method === "GET" && url.pathname === SSH_HOST_DIRECTORY_PATH) {
          const input = yield* Schema.decodeUnknownEffect(FilesystemBrowseInput)({
            partialPath: url.searchParams.get("path") || "~/",
          });
          return jsonResponse(
            yield* Effect.tryPromise({
              try: () => browseWorkspaceEntries(input),
              catch: (error) => error,
            }),
          );
        }
        if (request.method === "GET" && url.pathname === SSH_HOST_PROJECTS_PATH) {
          const shell = yield* query.getShellSnapshot();
          return jsonResponse({
            projects: shell.projects
              .filter((project) => project.kind === "project")
              .map((project) => ({
                id: project.id,
                name: project.title,
                path: project.workspaceRoot,
              })),
          });
        }
        if (request.method === "POST" && url.pathname === SSH_HOST_PROJECTS_PATH) {
          const input = yield* Schema.decodeUnknownEffect(SshProjectAddInput)(
            yield* readJson(request),
          );
          const engine = yield* OrchestrationEngineService;
          const startup = yield* ServerRuntimeStartup;
          return jsonResponse(
            yield* Effect.tryPromise({
              try: () =>
                addSshProject(input, {
                  getReadModel: engine.getReadModel,
                  dispatch: (command) => startup.enqueueCommand(engine.dispatch(command)),
                }),
              catch: (error) => error,
            }),
          );
        }
        return jsonResponse({ error: "Not found" }, 404);
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(
            jsonResponse(
              {
                error:
                  error instanceof Error ? error.message : "Could not access the remote project.",
              },
              400,
            ),
          ),
        ),
      );
    }

    return jsonResponse({ error: "Not found" }, 404);
  }),
);

const occupancyWebSocketRouteLayer = HttpRouter.add(
  "GET",
  GRAFT_DESKTOP_ENDPOINTS.socket,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    const environment = yield* ServerEnvironment;
    const query = yield* ProjectionSnapshotQuery;
    const descriptor = yield* environment.getDescriptor;
    const occupancy = occupancyRuntime(config, descriptor.label, () =>
      Effect.runPromise(query.getShellSnapshot()),
    );
    const bearer = parseOccupancyBearer(request.headers.authorization);
    if (!bearer || !occupancy.store.authenticateBearer(bearer)) {
      return HttpServerResponse.text("Unauthorized", { status: 401 });
    }

    const socket = yield* request.upgrade;
    const writer = yield* socket.writer;
    const inbound = yield* Queue.unbounded<unknown>();
    const outbound = yield* Queue.unbounded<string>();
    yield* Stream.fromQueue(outbound).pipe(Stream.runForEach(writer), Effect.forkScoped);

    const send = (message: unknown) =>
      Queue.offer(outbound, JSON.stringify(message)).pipe(Effect.asVoid);

    let connection: OccupancyConnection | null = null;

    const handleFrame = (raw: unknown) =>
      Effect.gen(function* () {
        const decoded = decodeSocketMessage(raw);
        if (!connection) {
          const opened = occupancy.protocol.open(bearer, decoded);
          if (!opened.ok) {
            yield* send({ envelope: "error", error: opened.error });
            return;
          }
          connection = opened.connection;
          for (const message of opened.messages) {
            yield* send(message);
          }
          return;
        }
        const activeConnection = connection;
        const messages = yield* Effect.promise(() =>
          occupancy.protocol.handle(activeConnection, decoded),
        );
        for (const message of messages) {
          yield* send(message);
        }
      });

    yield* Stream.fromQueue(inbound).pipe(Stream.runForEach(handleFrame), Effect.forkScoped);
    yield* socket.run((message) => {
      Effect.runFork(Queue.offer(inbound, message).pipe(Effect.asVoid));
    });
    return HttpServerResponse.empty();
  }),
);

export const graftOccupancyRouteLayer = Layer.mergeAll(
  occupancyWebSocketRouteLayer,
  occupancyHttpRouteLayer,
);

export { closeOccupancyRuntime };
