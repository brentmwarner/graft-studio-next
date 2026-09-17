import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerAuth } from "./auth/Services/ServerAuth";
import { authErrorResponse } from "./auth/effectHttp";
import { ServerConfig } from "./config";
import {
  authenticateDesktopOwner,
  graftOwnerCorsHeaders,
  graftOwnerPreflightResponse,
} from "./graftOwnerHttp";
import { legacyGraftRuntime } from "./legacyGraftRuntime";

export const legacyGraftRouteLayer = HttpRouter.add(
  "*",
  "/api/graft/legacy/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.empty({ status: 400 });
    const config = yield* ServerConfig;
    const headers = graftOwnerCorsHeaders({ request, url, config });
    if (!headers) return HttpServerResponse.empty({ status: 403 });
    if (request.method === "OPTIONS") return graftOwnerPreflightResponse(headers);
    const auth = yield* ServerAuth;
    const session = yield* authenticateDesktopOwner(request, url, config, auth);
    const respond = (value: unknown, status = 200) =>
      HttpServerResponse.jsonUnsafe(value, {
        status,
        headers: { ...headers, "Cache-Control": "no-store" },
      });
    if (session.role !== "owner")
      return respond({ error: "Only the owner can access imported history." }, 403);
    const runtime = legacyGraftRuntime(config);
    return yield* Effect.tryPromise({
      try: async () => {
        if (request.method === "GET" && url.pathname === "/api/graft/legacy/status") {
          return respond(await runtime.getStatus());
        }
        if (request.method === "POST" && url.pathname === "/api/graft/legacy/retry") {
          runtime.retry();
          return respond({ accepted: true });
        }
        if (request.method === "GET" && url.pathname === "/api/graft/legacy/thread") {
          const sourceThreadId = url.searchParams.get("id");
          const offset = Number(url.searchParams.get("offset") ?? "0");
          if (
            !sourceThreadId ||
            sourceThreadId.length > 512 ||
            !Number.isSafeInteger(offset) ||
            offset < 0
          ) {
            return respond({ error: "Invalid archive request." }, 400);
          }
          return respond(await runtime.readThread(sourceThreadId, offset));
        }
        return respond({ error: "Not found." }, 404);
      },
      catch: () => new Error("Graft could not read the imported history. Retry from Settings."),
    }).pipe(Effect.catch((error) => Effect.succeed(respond({ error: error.message }, 500))));
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);
