import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { AuthError, ServerAuth } from "../auth/Services/ServerAuth";
import { ServerConfig } from "../config";
import {
  authenticateDesktopOwner,
  graftOwnerCorsHeaders,
  graftOwnerPreflightResponse,
} from "../graftOwnerHttp";
import { SshRemoteError } from "./sshRemoteTypes";
import { closeSshConnectionManager, sshConnectionManager } from "./sshRuntime";

function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return HttpServerResponse.jsonUnsafe(value, { status, headers });
}

function sshErrorResponse(error: unknown, headers: Record<string, string> = {}) {
  if (error instanceof SshRemoteError) {
    return jsonResponse(
      { error: error.message, code: error.code, retryable: error.retryable },
      error.retryable ? 503 : 400,
      headers,
    );
  }
  return jsonResponse(
    { error: error instanceof Error ? error.message : "SSH request failed" },
    500,
    headers,
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
    const config = yield* ServerConfig;
    const corsHeaders = graftOwnerCorsHeaders({ request, url, config });
    if (corsHeaders === null) {
      return jsonResponse({ error: "Trusted request origin required." }, 403);
    }
    if (request.method === "OPTIONS") {
      return graftOwnerPreflightResponse(corsHeaders);
    }
    const serverAuth = yield* ServerAuth;
    const authenticated = yield* authenticateDesktopOwner(request, url, config, serverAuth);
    if (authenticated.role !== "owner") {
      return jsonResponse({ error: "Only the owner can manage SSH machines." }, 403, corsHeaders);
    }
    const manager = sshConnectionManager(config);
    const respond = (value: unknown, status = 200) => jsonResponse(value, status, corsHeaders);
    const fail = (error: unknown) => sshErrorResponse(error, corsHeaders);

    if (request.method === "GET" && url.pathname === "/api/graft/ssh/machines") {
      return respond({ machines: manager.listMachineSummaries() });
    }

    if (request.method === "POST" && url.pathname === "/api/graft/ssh/machines") {
      const body = yield* Effect.promise(() => readJson(request));
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return respond({ error: "Invalid SSH machine" }, 400);
      }
      const record = body as { label?: unknown; sshTarget?: unknown };
      if (typeof record.label !== "string" || typeof record.sshTarget !== "string") {
        return respond({ error: "SSH machine label and target are required" }, 400);
      }
      try {
        const machine = manager.saveMachine({
          label: record.label,
          sshTarget: record.sshTarget,
        });
        return respond({ machine: manager.machineSummary(machine) });
      } catch (error) {
        return fail(error);
      }
    }

    const machineId = machineIdFromPath(url.pathname);
    if (!machineId) return respond({ error: "Not found" }, 404);

    if (request.method === "DELETE" && url.pathname === `/api/graft/ssh/machines/${machineId}`) {
      const deleted = yield* Effect.promise(() => manager.deleteMachine(machineId));
      return respond({ deleted });
    }

    if (
      request.method === "POST" &&
      url.pathname === `/api/graft/ssh/machines/${machineId}/connect`
    ) {
      try {
        const connection = yield* Effect.promise(() => manager.connect(machineId));
        return respond({
          machine: manager.machineSummary(connection.machine),
          localPort: connection.localPort,
          routes: connection.routes,
        });
      } catch (error) {
        return fail(error);
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === `/api/graft/ssh/machines/${machineId}/disconnect`
    ) {
      yield* Effect.promise(() => manager.disconnect(machineId));
      const machine = manager.listMachines().find((entry) => entry.id === machineId);
      return respond({
        machine: machine ? manager.machineSummary(machine) : null,
      });
    }

    return respond({ error: "Not found" }, 404);
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = HttpServerRequest.toURL(request);
        const config = yield* ServerConfig;
        const headers =
          url === undefined ? {} : (graftOwnerCorsHeaders({ request, url, config }) ?? {});
        return error instanceof AuthError
          ? jsonResponse({ error: error.message }, error.status ?? 401, headers)
          : sshErrorResponse(error, headers);
      }),
    ),
  ),
);

export const graftSshRouteLayer = sshHttpRouteLayer;

export { closeSshConnectionManager };
