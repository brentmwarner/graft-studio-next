import http from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthSessionId } from "@graft/contracts";
import { Effect, Exit, Layer, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it, vi } from "vitest";

import { AuthError, ServerAuth, type ServerAuthShape } from "./auth/Services/ServerAuth";
import { ServerConfig, type ServerConfigShape } from "./config";
import { legacyGraftRouteLayer } from "./legacyGraftHttp";

const runtime = vi.hoisted(() => ({
  getStatus: vi.fn(async () => ({ phase: "no-source", progress: null, error: null })),
  retry: vi.fn(),
  readThread: vi.fn(async () => ({ records: [], nextOffset: null })),
}));
vi.mock("./legacyGraftRuntime", () => ({ legacyGraftRuntime: () => runtime }));

async function withServer(run: (origin: string) => Promise<void>) {
  const scope = await Effect.runPromise(Scope.make("sequential"));
  const nodeServer = http.createServer();
  try {
    await Effect.runPromise(
      Scope.provide(
        Effect.gen(function* () {
          const server = yield* NodeHttpServer.make(() => nodeServer, {
            host: "127.0.0.1",
            port: 0,
          });
          yield* server.serve(yield* HttpRouter.toHttpEffect(legacyGraftRouteLayer));
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              NodeServices.layer,
              Layer.succeed(ServerConfig, {
                mode: "desktop",
                host: "127.0.0.1",
                port: 3773,
                authToken: "test-owner-token",
              } as ServerConfigShape),
              Layer.succeed(ServerAuth, {
                authenticateHttpRequest: (request) =>
                  request.headers.authorization === "Bearer paired-client"
                    ? Effect.succeed({
                        sessionId: AuthSessionId.makeUnsafe("client"),
                        subject: "client",
                        method: "bearer-session-token",
                        credentialSource: "bearer",
                        role: "client",
                      })
                    : Effect.fail(
                        new AuthError({ message: "Authentication required.", status: 401 }),
                      ),
              } as Pick<ServerAuthShape, "authenticateHttpRequest"> as ServerAuthShape),
            ),
          ),
        ),
        scope,
      ),
    );
    const address = nodeServer.address();
    if (!address || typeof address === "string") throw new Error("Missing listener");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    vi.clearAllMocks();
  }
}

describe("legacy history owner routes", () => {
  it("requires owner credentials and a trusted browser origin before reading history", async () => {
    await withServer(async (origin) => {
      expect((await fetch(`${origin}/api/graft/legacy/status`)).status).toBe(401);
      expect(
        (
          await fetch(`${origin}/api/graft/legacy/status`, {
            headers: { Authorization: "Bearer paired-client" },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${origin}/api/graft/legacy/status?token=test-owner-token`, {
            headers: { Origin: "https://untrusted.example" },
          })
        ).status,
      ).toBe(403);
      expect(runtime.getStatus).not.toHaveBeenCalled();
      const response = await fetch(`${origin}/api/graft/legacy/status?token=test-owner-token`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ phase: "no-source" });
    });
  });

  it("rejects invalid archive offsets and only retries on authenticated POST", async () => {
    await withServer(async (origin) => {
      expect(
        (
          await fetch(
            `${origin}/api/graft/legacy/thread?token=test-owner-token&id=thread&offset=-1`,
          )
        ).status,
      ).toBe(400);
      expect(runtime.readThread).not.toHaveBeenCalled();
      expect((await fetch(`${origin}/api/graft/legacy/retry?token=test-owner-token`)).status).toBe(
        404,
      );
      expect(
        (await fetch(`${origin}/api/graft/legacy/retry?token=test-owner-token`, { method: "POST" }))
          .status,
      ).toBe(200);
      expect(runtime.retry).toHaveBeenCalledOnce();
    });
  });
});
