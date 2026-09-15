import http from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { GraftThreadUsageSchema } from "@graft/mobile-contract";
import { Effect, Exit, Layer, Option, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, it, vi } from "vitest";

import { AuthError, ServerAuth, type AuthRequest } from "../auth/Services/ServerAuth";
import { ServerConfig } from "../config";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { ProviderDiscoveryService } from "../provider/Services/ProviderDiscoveryService";
import { listProviderUsage } from "../providerUsage";
import { ServerSettingsService } from "../serverSettings";
import { graftMobileRouteLayer } from "./httpRoute";

vi.mock("../providerUsage", () => ({ listProviderUsage: vi.fn() }));

it("authenticates thread usage, selects its provider, and returns only public meter data", async () => {
  const now = "2026-09-14T12:00:00.000Z";
  const source = { provider: "codex" as const, updatedAt: now, status: "ok" as const, source: "provider-api",
    limits: [{ window: "Weekly", usedPercent: 36, windowDurationMins: 10080 }], usageLines: [], detail: "private diagnostic" };
  vi.mocked(listProviderUsage).mockReturnValue(Effect.succeed([source]));
  const getDetail = vi.fn((id: string) => Effect.succeed(id === "thread-usage" ? Option.some({
    thread: { modelSelection: { provider: "codex", model: "codex" }, activities: [
      { kind: "context-window.updated", payload: { usedTokens: 25000, maxTokens: 100000 }, createdAt: now },
    ] },
  }) : Option.none()));
  const scope = await Effect.runPromise(Scope.make("sequential"));
  let server: http.Server | null = null;
  try {
    await Effect.runPromise(Scope.provide(Effect.gen(function* () {
      const host = yield* NodeHttpServer.make(() => { server = http.createServer(); return server; }, { port: 0, host: "127.0.0.1" });
      yield* host.serve(yield* HttpRouter.toHttpEffect(graftMobileRouteLayer));
    }).pipe(Effect.provide(Layer.mergeAll(
      NodeServices.layer,
      Layer.succeed(ServerConfig, {} as never),
      Layer.succeed(ServerEnvironment, {} as never),
      Layer.succeed(ServerSettingsService, {} as never),
      Layer.succeed(ProviderDiscoveryService, {} as never),
      Layer.succeed(OrchestrationEngineService, {} as never),
      Layer.succeed(ProjectionSnapshotQuery, { getThreadDetailSnapshotById: getDetail } as never),
      Layer.succeed(ServerAuth, { authenticateHttpRequest: (request: AuthRequest) => request.headers.authorization === "Bearer usage-test"
        ? Effect.succeed({ sessionId: "test", role: "client" }) : Effect.fail(new AuthError({ message: "Sign in required", status: 401 })) } as never),
    ))), scope));
    const address = (server as http.Server | null)?.address();
    if (!address || typeof address !== "object") throw new Error("No test server address");
    const base = `http://127.0.0.1:${address.port}/v1/usage`;
    expect((await fetch(`${base}?threadId=thread-usage`)).status).toBe(401);
    expect(getDetail).not.toHaveBeenCalled();
    expect(listProviderUsage).not.toHaveBeenCalled();
    const headers = { authorization: "Bearer usage-test" };
    expect((await fetch(base, { headers })).status).toBe(400);
    expect((await fetch(`${base}?threadId=missing`, { headers })).status).toBe(404);
    expect(listProviderUsage).not.toHaveBeenCalled();
    const response = await fetch(`${base}?threadId=thread-usage`, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(GraftThreadUsageSchema.parse(body)).toMatchObject({ threadId: "thread-usage",
      contextUsage: { percent: 25, source: "measured" },
      allowance: { providerId: "codex", limits: [{ label: "Weekly", remainingPercent: 64 }] },
    });
    expect(listProviderUsage).toHaveBeenCalledWith({ provider: "codex" });
    expect(JSON.stringify(body)).not.toContain("private diagnostic");
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
});
