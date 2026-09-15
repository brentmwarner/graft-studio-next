import { AuthSessionId } from "@graft/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { AuthError } from "./auth/Services/ServerAuth";
import { authenticateDesktopOwner, graftOwnerCorsHeaders } from "./graftOwnerHttp";
import type { ServerConfigShape } from "./config";

const loopbackConfig = {
  mode: "desktop",
  host: "127.0.0.1",
  port: 3773,
  authToken: "desktop-secret",
} as ServerConfigShape;

function request(input: { origin?: string; url: string }) {
  return {
    headers: input.origin ? { origin: input.origin } : {},
  } as never;
}

describe("graft owner HTTP", () => {
  it("allows the Vite desktop origin to call owner routes", () => {
    const headers = graftOwnerCorsHeaders({
      request: request({
        origin: "http://localhost:8891",
        url: "http://127.0.0.1:3773/v1/pairing-link",
      }),
      url: new URL("http://127.0.0.1:3773/v1/pairing-link"),
      config: { ...loopbackConfig, devUrl: new URL("http://localhost:8891/") } as ServerConfigShape,
    });
    expect(headers).toMatchObject({
      "Access-Control-Allow-Origin": "http://localhost:8891",
      "Access-Control-Allow-Credentials": "true",
    });
  });

  it("allows IPv6 loopback renderer origins used by Electron", () => {
    const headers = graftOwnerCorsHeaders({
      request: request({
        origin: "http://[::1]:8891",
        url: "http://127.0.0.1:3773/v1/pairing-link",
      }),
      url: new URL("http://127.0.0.1:3773/v1/pairing-link"),
      config: loopbackConfig,
    });
    expect(headers).toMatchObject({
      "Access-Control-Allow-Origin": "http://[::1]:8891",
    });
  });

  it("rejects an unrelated browser origin", () => {
    expect(
      graftOwnerCorsHeaders({
        request: request({
          origin: "https://evil.example",
          url: "http://127.0.0.1:3773/v1/pairing-link",
        }),
        url: new URL("http://127.0.0.1:3773/v1/pairing-link"),
        config: loopbackConfig,
      }),
    ).toBeNull();
  });

  it("does not treat a missing auth token as the owner", async () => {
    await expect(
      Effect.runPromise(
        authenticateDesktopOwner(
          request({ url: "http://127.0.0.1:3773/v1/pairing-link" }),
          new URL("http://127.0.0.1:3773/v1/pairing-link"),
          { ...loopbackConfig, authToken: undefined },
          {
            authenticateHttpRequest: () =>
              Effect.fail(new AuthError({ message: "Authentication required.", status: 401 })),
          },
        ),
      ),
    ).rejects.toThrow(/Authentication required/);
  });

  it("treats the desktop websocket token as the owner", async () => {
    const session = await Effect.runPromise(
      authenticateDesktopOwner(
        request({ url: "http://127.0.0.1:3773/v1/pairing-link?token=desktop-secret" }),
        new URL("http://127.0.0.1:3773/v1/pairing-link?token=desktop-secret"),
        loopbackConfig,
        {
          authenticateHttpRequest: () =>
            Effect.fail(new AuthError({ message: "Authentication required.", status: 401 })),
        },
      ),
    );
    expect(session.role).toBe("owner");
    expect(session.sessionId).toBe(AuthSessionId.makeUnsafe("desktop-legacy-token"));
  });

  it("does not apply the localhost CORS exception in web mode", () => {
    expect(
      graftOwnerCorsHeaders({
        request: request({
          origin: "http://localhost:8891",
          url: "http://127.0.0.1:3773/v1/pairing-link",
        }),
        url: new URL("http://127.0.0.1:3773/v1/pairing-link"),
        config: { ...loopbackConfig, mode: "web" } as ServerConfigShape,
      }),
    ).toBeNull();
  });
});
