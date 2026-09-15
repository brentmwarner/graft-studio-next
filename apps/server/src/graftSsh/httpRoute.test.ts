import http from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, Layer, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it, vi } from "vitest";

import { ServerAuth } from "../auth/Services/ServerAuth";
import { ServerConfig, type ServerConfigShape } from "../config";
import { graftSshRouteLayer } from "./httpRoute";
import { SshRemoteError } from "./sshRemoteTypes";

const manager = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  deleteMachine: vi.fn(),
  activeConnection: vi.fn(),
}));
vi.mock("./sshRuntime", () => ({
  sshConnectionManager: () => manager,
  closeSshConnectionManager: async () => undefined,
}));

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
          yield* server.serve(yield* HttpRouter.toHttpEffect(graftSshRouteLayer));
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
              Layer.succeed(ServerAuth, {} as never),
            ),
          ),
        ),
        scope,
      ),
    );
    const address = nodeServer.address();
    if (!address || typeof address === "string") throw new Error("Missing test listener");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    vi.resetAllMocks();
  }
}

describe("SSH HTTP failures", () => {
  it("rejects remote project access while disconnected", async () => {
    manager.activeConnection.mockReturnValue(null);
    await withServer(async (origin) => {
      const response = await fetch(
        `${origin}/api/graft/ssh/machines/example/projects?token=test-owner-token`,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "connection_closed" });
    });
  });

  it("proxies project reads with the remote credential kept on the server", async () => {
    const bearer = "test-private-remote-session";
    const upstream = http.createServer((request, response) => {
      expect(request.headers.authorization).toBe(`Bearer ${bearer}`);
      expect(request.url).toBe("/desktop/v1/projects");
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          projects: [{ id: "remote-project", name: "Remote repo", path: "/srv/repo" }],
        }),
      );
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("Missing upstream listener");
    manager.activeConnection.mockReturnValue({
      routes: { httpBaseUrl: `http://127.0.0.1:${address.port}` },
      bearer,
      session: { grants: ["projects"] },
    });
    try {
      await withServer(async (origin) => {
        const response = await fetch(
          `${origin}/api/graft/ssh/machines/example/projects?token=test-owner-token`,
        );
        expect(response.status).toBe(200);
        const result = await response.text();
        expect(result).toContain("Remote repo");
        expect(result).not.toContain(bearer);
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it.each([
    ["network_unreachable", true, 503],
    ["authentication_required", false, 400],
    ["host_key_verification_failed", false, 400],
    ["install_failed", false, 400],
  ] as const)(
    "returns actionable JSON and CORS headers for %s",
    async (code, retryable, status) => {
      const message = `Connection failed at ${code}`;
      manager.connect.mockRejectedValue(new SshRemoteError(code, message, retryable));
      await withServer(async (origin) => {
        const response = await fetch(
          `${origin}/api/graft/ssh/machines/example/connect?token=test-owner-token`,
          {
            method: "POST",
            headers: { Origin: "http://localhost:5856" },
          },
        );
        expect(response.status).toBe(status);
        expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5856");
        expect(await response.json()).toEqual({ error: message, code, retryable });
      });
    },
  );

  it.each(["disconnect", "deleteMachine"] as const)(
    "serializes rejected %s operations",
    async (operation) => {
      manager[operation].mockRejectedValue(new Error("Could not update the connection"));
      await withServer(async (origin) => {
        const suffix = operation === "disconnect" ? "/disconnect" : "";
        const response = await fetch(
          `${origin}/api/graft/ssh/machines/example${suffix}?token=test-owner-token`,
          {
            method: operation === "disconnect" ? "POST" : "DELETE",
          },
        );
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: "Could not update the connection" });
      });
    },
  );
});
