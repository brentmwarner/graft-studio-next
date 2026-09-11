import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { makeEffectAuthRequest } from "../auth/effectHttp";
import { AuthError, ServerAuth } from "../auth/Services/ServerAuth";
import { ServerConfig } from "../config";
import { SshRemoteError } from "./sshRemoteTypes";
import { closeSshConnectionManager, sshConnectionManager } from "./sshRuntime";

function jsonResponse(value: unknown, status = 200) {
  return HttpServerResponse.jsonUnsafe(value, { status });
}

function sshErrorResponse(error: unknown) {
  if (error instanceof SshRemoteError) {
    return jsonResponse(
      { error: error.message, code: error.code, retryable: error.retryable },
      error.retryable ? 503 : 400,
    );
  }
  return jsonResponse(
    { error: error instanceof Error ? error.message : "SSH request failed" },
    500,
  );
}

async function readJson(request: HttpServerRequest.HttpServerRequest): Promise<unknown> {
  try {
    return await Effect.runPromise(request.json);
  } catch {
    return null;
  }
}

function machineIdFromPath(pathname: string): string | null {
  const match = /^\/api\/graft\/ssh\/machines\/([^/]+)(?:\/(connect|disconnect))?$/u.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

const sshHttpRouteLayer = HttpRouter.add(
  "*",
  "/api/graft/ssh/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return jsonResponse({ error: "Bad request" }, 400);
    const serverAuth = yield* ServerAuth;
    const authenticated = yield* serverAuth.authenticateHttpRequest(makeEffectAuthRequest(request));
    if (authenticated.role !== "owner") {
      return jsonResponse({ error: "Only the owner can manage SSH machines." }, 403);
    }
    const config = yield* ServerConfig;
    const manager = sshConnectionManager(config);

    if (request.method === "GET" && url.pathname === "/api/graft/ssh/machines") {
      return jsonResponse({ machines: manager.listMachineSummaries() });
    }

    if (request.method === "POST" && url.pathname === "/api/graft/ssh/machines") {
      const body = yield* Effect.promise(() => readJson(request));
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return jsonResponse({ error: "Invalid SSH machine" }, 400);
      }
      const record = body as { label?: unknown; sshTarget?: unknown };
      if (typeof record.label !== "string" || typeof record.sshTarget !== "string") {
        return jsonResponse({ error: "SSH machine label and target are required" }, 400);
      }
      try {
        const machine = manager.saveMachine({
          label: record.label,
          sshTarget: record.sshTarget,
        });
        return jsonResponse({ machine: manager.machineSummary(machine) });
      } catch (error) {
        return sshErrorResponse(error);
      }
    }

    const machineId = machineIdFromPath(url.pathname);
    if (!machineId) return jsonResponse({ error: "Not found" }, 404);

    if (request.method === "DELETE" && url.pathname === `/api/graft/ssh/machines/${machineId}`) {
      const deleted = yield* Effect.promise(() => manager.deleteMachine(machineId));
      return jsonResponse({ deleted });
    }

    if (
      request.method === "POST" &&
      url.pathname === `/api/graft/ssh/machines/${machineId}/connect`
    ) {
      try {
        const connection = yield* Effect.promise(() => manager.connect(machineId));
        return jsonResponse({
          machine: manager.machineSummary(connection.machine),
          localPort: connection.localPort,
          routes: connection.routes,
        });
      } catch (error) {
        return sshErrorResponse(error);
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === `/api/graft/ssh/machines/${machineId}/disconnect`
    ) {
      yield* Effect.promise(() => manager.disconnect(machineId));
      const machine = manager.listMachines().find((entry) => entry.id === machineId);
      return jsonResponse({
        machine: machine ? manager.machineSummary(machine) : null,
      });
    }

    return jsonResponse({ error: "Not found" }, 404);
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        error instanceof AuthError
          ? HttpServerResponse.jsonUnsafe(
              { error: error.message },
              { status: error.status ?? 401 },
            )
          : sshErrorResponse(error),
      ),
    ),
  ),
);

export const graftSshRouteLayer = sshHttpRouteLayer;

export { closeSshConnectionManager };
