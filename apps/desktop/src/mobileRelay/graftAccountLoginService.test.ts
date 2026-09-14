import { createHash } from "node:crypto";
import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders,
} from "node:http";
import { connect as connectSocket, type Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GraftAccountLoginService,
  type GraftAccountLoginCompletion,
} from "./graftAccountLoginService";

const VALID_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhY2N0X3Rlc3QifQ.signature";
const TOKEN_CANARY = "eyJhbGciOiJIUzI1NiJ9.eyJzZWNyZXQiOiJUT0tFTl9DQU5BUlkifQ.signature";
const activeServices: GraftAccountLoginService[] = [];

interface LoopbackResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

interface CallbackRequestOptions {
  port: number;
  path?: string;
  method?: string;
  hostHeader?: string;
  contentType?: string | null;
  body?: string;
  contentLength?: number | null;
  transferEncoding?: "chunked";
  connectHost?: string;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function opaqueToken(character: string): string {
  return character.repeat(43);
}

function deriveChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function callbackRequest(options: CallbackRequestOptions): Promise<LoopbackResponse> {
  const body = options.body ?? "";
  const headers: OutgoingHttpHeaders = {
    Host: options.hostHeader ?? `127.0.0.1:${options.port}`,
  };
  if (options.contentType !== null) {
    headers["Content-Type"] = options.contentType ?? "application/x-www-form-urlencoded";
  }
  if (options.contentLength !== null) {
    headers["Content-Length"] = options.contentLength ?? Buffer.byteLength(body);
  }
  if (options.transferEncoding) {
    delete headers["Content-Length"];
    headers["Transfer-Encoding"] = options.transferEncoding;
  }

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: options.connectHost ?? "127.0.0.1",
        port: options.port,
        path: options.path ?? "/auth/callback",
        method: options.method ?? "POST",
        headers,
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(1000, () => {
      request.destroy(new Error("Loopback request timed out"));
    });
    request.end(body);
  });
}

function partialCallbackSocket(options: { port: number; state: string }): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectSocket({
      host: "127.0.0.1",
      port: options.port,
    });
    const onError = (error: Error) => {
      reject(error);
    };
    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      socket.on("error", () => undefined);
      const fullBody = validCallbackBody(options.state);
      const partialBody = fullBody.slice(0, Math.floor(fullBody.length / 2));
      socket.write(
        [
          "POST /auth/callback HTTP/1.1",
          `Host: 127.0.0.1:${options.port}`,
          "Content-Type: application/x-www-form-urlencoded",
          `Content-Length: ${Buffer.byteLength(fullBody)}`,
          "Connection: keep-alive",
          "",
          partialBody,
        ].join("\r\n"),
      );
      resolve(socket);
    });
  });
}

function waitForSocketClose(socket: Socket): Promise<void> {
  if (socket.destroyed) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    socket.once("close", () => resolve());
  });
}

function expectResolvesWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("Promise did not resolve before timeout"));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

function parseSignInUrl(openedUrls: string[]): {
  url: URL;
  port: number;
  state: string;
  challenge: string;
} {
  expect(openedUrls).not.toHaveLength(0);
  const url = new URL(openedUrls.at(-1) ?? "");
  const port = Number(url.searchParams.get("callback_port"));
  const state = url.searchParams.get("state") ?? "";
  const challenge = url.searchParams.get("code_challenge") ?? "";
  expect(port).toBeGreaterThan(0);
  expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(url.searchParams.get("flow_version")).toBe("2");
  return { url, port, state, challenge };
}

function validCallbackBody(state: string, grant = opaqueToken("g")): string {
  return new URLSearchParams({ grant, state }).toString();
}

function createHarness(
  input: {
    fetchImpl?: typeof fetch;
    persistToken?: (token: string) => Promise<void>;
    openExternal?: (url: string) => void | Promise<void>;
    timeoutMs?: number;
  } = {},
) {
  const openedUrls: string[] = [];
  const persistedTokens: string[] = [];
  const completions: GraftAccountLoginCompletion[] = [];
  const fetchImpl =
    input.fetchImpl ??
    (vi.fn(async () =>
      jsonResponse({
        token: VALID_JWT,
        email: "person@example.com",
        name: "Example Person",
      }),
    ) as unknown as typeof fetch);
  const persistToken =
    input.persistToken ??
    (async (token: string) => {
      persistedTokens.push(token);
    });
  const service = new GraftAccountLoginService({
    controlPlaneBaseUrl: "https://control.graft.test",
    openExternal:
      input.openExternal ??
      ((url) => {
        openedUrls.push(url);
      }),
    persistToken,
    fetchImpl,
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    onComplete: (completion) => {
      completions.push(completion);
    },
  });
  activeServices.push(service);
  return {
    service,
    openedUrls,
    persistedTokens,
    completions,
    fetchImpl,
  };
}

function findExternalIpv4Address(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }
  return null;
}

afterEach(async () => {
  while (activeServices.length > 0) {
    await activeServices.pop()?.dispose();
  }
});

describe("GraftAccountLoginService", () => {
  it("binds an OS-assigned IPv4 loopback port and opens only state/challenge metadata", async () => {
    const harness = createHarness();
    await expect(harness.service.start()).resolves.toEqual({ ok: true });
    const signIn = parseSignInUrl(harness.openedUrls);

    expect(signIn.url.origin).toBe("https://control.graft.test");
    expect(signIn.url.pathname).toBe("/auth/login");
    expect(signIn.url.toString()).not.toContain("code_verifier");
    expect(signIn.url.toString()).not.toContain(VALID_JWT);
    expect(signIn.url.toString()).not.toContain(TOKEN_CANARY);

    const externalAddress = findExternalIpv4Address();
    if (externalAddress) {
      await expect(
        callbackRequest({
          port: signIn.port,
          connectHost: externalAddress,
          body: validCallbackBody(signIn.state),
        }),
      ).rejects.toThrow();
    }
    expect(harness.completions).toEqual([]);
    expect(harness.persistedTokens).toEqual([]);
  });

  it("rejects wrong method, path, host, content type, length, body, grant, and state without closing", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ token: VALID_JWT }),
    ) as unknown as typeof fetch;
    const harness = createHarness({ fetchImpl });
    await harness.service.start();
    const signIn = parseSignInUrl(harness.openedUrls);
    const validBody = validCallbackBody(signIn.state);
    const invalidRequests: CallbackRequestOptions[] = [
      {
        port: signIn.port,
        method: "GET",
        body: "",
      },
      {
        port: signIn.port,
        path: "/other",
        body: validBody,
      },
      {
        port: signIn.port,
        hostHeader: `localhost:${signIn.port}`,
        body: validBody,
      },
      {
        port: signIn.port,
        contentType: "application/json",
        body: validBody,
      },
      {
        port: signIn.port,
        contentLength: null,
        transferEncoding: "chunked",
        body: validBody,
      },
      {
        port: signIn.port,
        body: "x".repeat(2049),
      },
      {
        port: signIn.port,
        body: `grant=${opaqueToken("g")}&state=${signIn.state}&state=${signIn.state}`,
      },
      {
        port: signIn.port,
        body: `grant=short&state=${signIn.state}`,
      },
      {
        port: signIn.port,
        body: validCallbackBody(opaqueToken("x")),
      },
      {
        port: signIn.port,
        body: `grant=${opaqueToken("g")}&state=%GG`,
      },
    ];

    for (const request of invalidRequests) {
      const response = await callbackRequest(request);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers["cache-control"]).toContain("no-store");
      expect(response.body).not.toContain(VALID_JWT);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(harness.persistedTokens).toEqual([]);
    expect(harness.completions).toEqual([]);

    const success = await callbackRequest({
      port: signIn.port,
      body: validBody,
    });
    expect(success.status).toBe(200);
    expect(harness.persistedTokens).toEqual([VALID_JWT]);
    expect(harness.completions).toEqual([{ ok: true }]);
  });

  it("keeps listening after a well-formed invalid grant, then accepts the correct grant", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "RAW_SERVER_DETAIL_CANARY" }, 401))
      .mockResolvedValueOnce(
        jsonResponse({
          token: VALID_JWT,
          email: "person@example.com",
        }),
      ) as unknown as typeof fetch;
    const harness = createHarness({ fetchImpl });
    await harness.service.start();
    const signIn = parseSignInUrl(harness.openedUrls);

    const invalid = await callbackRequest({
      port: signIn.port,
      body: validCallbackBody(signIn.state, opaqueToken("x")),
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body).not.toContain("RAW_SERVER_DETAIL_CANARY");
    expect(harness.completions).toEqual([]);
    expect(harness.persistedTokens).toEqual([]);

    const valid = await callbackRequest({
      port: signIn.port,
      body: validCallbackBody(signIn.state),
    });
    expect(valid.status).toBe(200);
    expect(harness.persistedTokens).toEqual([VALID_JWT]);
    expect(harness.completions).toEqual([{ ok: true, email: "person@example.com" }]);
  });

  it("sends the private verifier only to the pinned HTTPS exchange endpoint", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ token: VALID_JWT }),
    ) as unknown as typeof fetch;
    const harness = createHarness({ fetchImpl });
    await harness.service.start();
    const signIn = parseSignInUrl(harness.openedUrls);
    await callbackRequest({
      port: signIn.port,
      body: validCallbackBody(signIn.state),
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [requestUrl, requestInit] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(requestUrl).toBe("https://control.graft.test/auth/desktop/exchange");
    expect(requestInit).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    const body = JSON.parse(String(requestInit?.body)) as {
      grant: string;
      code_verifier: string;
      flow_version: string;
    };
    expect(body.grant).toBe(opaqueToken("g"));
    expect(body.flow_version).toBe("2");
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(deriveChallenge(body.code_verifier)).toBe(signIn.challenge);
    expect(signIn.url.toString()).not.toContain(body.code_verifier);
  });

  it("persists before listener close and emits only sanitized identity metadata", async () => {
    const events: string[] = [];
    const completions: GraftAccountLoginCompletion[] = [];
    const service = new GraftAccountLoginService({
      controlPlaneBaseUrl: "https://control.graft.test",
      openExternal: (url) => {
        events.push(`opened:${url}`);
      },
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          token: TOKEN_CANARY,
          email: "person@example.com",
          name: "Example Person",
        }),
      ) as unknown as typeof fetch,
      persistToken: async (token) => {
        expect(token).toBe(TOKEN_CANARY);
        events.push("persisted");
      },
      onComplete: (completion) => {
        events.push("completed");
        completions.push(completion);
      },
    });
    activeServices.push(service);
    await service.start();
    const openedUrl = events[0]?.slice("opened:".length) ?? "";
    const signIn = parseSignInUrl([openedUrl]);
    const response = await callbackRequest({
      port: signIn.port,
      body: validCallbackBody(signIn.state),
    });

    expect(response.status).toBe(200);
    expect(response.headers.connection).toBe("close");
    expect(response.body).toContain("Sign-in complete");
    expect(response.body).not.toContain(TOKEN_CANARY);
    expect(events.slice(1)).toEqual(["persisted", "completed"]);
    expect(completions).toEqual([
      {
        ok: true,
        email: "person@example.com",
        name: "Example Person",
      },
    ]);
    expect(JSON.stringify(completions)).not.toContain(TOKEN_CANARY);
    await expect(
      callbackRequest({
        port: signIn.port,
        body: validCallbackBody(signIn.state),
      }),
    ).rejects.toThrow();
  });

  it("a newer login cancels the first and a late first callback cannot persist", async () => {
    const firstExchange = deferred<Response>();
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => firstExchange.promise)
      .mockResolvedValueOnce(jsonResponse({ token: VALID_JWT })) as unknown as typeof fetch;
    const harness = createHarness({ fetchImpl });
    await harness.service.start();
    const first = parseSignInUrl(harness.openedUrls);
    const lateCallback = callbackRequest({
      port: first.port,
      body: validCallbackBody(first.state, opaqueToken("a")),
    });
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    const secondStart = harness.service.start();
    firstExchange.resolve(jsonResponse({ token: TOKEN_CANARY }));
    const lateStatus = await lateCallback.then(
      (response) => response.status,
      () => 0,
    );
    expect([0, 409]).toContain(lateStatus);
    await secondStart;
    const second = parseSignInUrl(harness.openedUrls);
    expect(second.state).not.toBe(first.state);
    expect(harness.persistedTokens).toEqual([]);
    expect(harness.completions).toEqual([]);

    const oldStateOnNewListener = await callbackRequest({
      port: second.port,
      body: validCallbackBody(first.state, opaqueToken("a")),
    });
    expect(oldStateOnNewListener.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const success = await callbackRequest({
      port: second.port,
      body: validCallbackBody(second.state, opaqueToken("b")),
    });
    expect(success.status).toBe(200);
    expect(harness.persistedTokens).toEqual([VALID_JWT]);
    expect(harness.completions).toEqual([{ ok: true }]);
  });

  it("does not persist when cancellation linearizes before callback commit", async () => {
    const exchange = deferred<Response>();
    const fetchImpl = vi.fn(() => exchange.promise) as unknown as typeof fetch;
    const harness = createHarness({ fetchImpl });
    await harness.service.start();
    const signIn = parseSignInUrl(harness.openedUrls);
    const callback = callbackRequest({
      port: signIn.port,
      body: validCallbackBody(signIn.state),
    }).then(
      (response) => response.status,
      () => 0,
    );
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledOnce();
    });

    await harness.service.cancel();
    exchange.resolve(jsonResponse({ token: TOKEN_CANARY }));
    const callbackStatus = await callback;
    expect([0, 409]).toContain(callbackStatus);
    await Promise.resolve();
    expect(harness.persistedTokens).toEqual([]);
    expect(harness.completions).toEqual([]);
  });

  it("does not persist when timeout linearizes before callback commit", async () => {
    const exchange = deferred<Response>();
    const fetchImpl = vi.fn(() => exchange.promise) as unknown as typeof fetch;
    const harness = createHarness({ fetchImpl, timeoutMs: 25 });
    await harness.service.start();
    const signIn = parseSignInUrl(harness.openedUrls);
    const callback = callbackRequest({
      port: signIn.port,
      body: validCallbackBody(signIn.state),
    }).then(
      (response) => response.status,
      () => 0,
    );
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledOnce();
    });
    await vi.waitFor(() => {
      expect(harness.completions).toEqual([{ ok: false, error: "timeout" }]);
    });

    exchange.resolve(jsonResponse({ token: TOKEN_CANARY }));
    const callbackStatus = await callback;
    expect([0, 409]).toContain(callbackStatus);
    await Promise.resolve();
    expect(harness.persistedTokens).toEqual([]);
    expect(harness.completions).toEqual([{ ok: false, error: "timeout" }]);
  });

  it("does not make a newer login authoritative during credential persistence", async () => {
    const persistenceStarted = deferred<void>();
    const releasePersistence = deferred<void>();
    const persistedTokens: string[] = [];
    const harness = createHarness({
      persistToken: async (token) => {
        persistenceStarted.resolve(undefined);
        await releasePersistence.promise;
        persistedTokens.push(token);
      },
    });
    await harness.service.start();
    const first = parseSignInUrl(harness.openedUrls);
    const firstCallback = callbackRequest({
      port: first.port,
      body: validCallbackBody(first.state),
    });
    await persistenceStarted.promise;

    const secondStart = harness.service.start();
    await Promise.resolve();
    expect(harness.openedUrls).toHaveLength(1);
    expect(persistedTokens).toEqual([]);
    expect(harness.completions).toEqual([]);

    releasePersistence.resolve(undefined);
    expect((await firstCallback).status).toBe(200);
    await secondStart;
    expect(persistedTokens).toEqual([VALID_JWT]);
    expect(harness.completions).toEqual([
      {
        ok: true,
        email: "person@example.com",
        name: "Example Person",
      },
    ]);
    expect(harness.openedUrls).toHaveLength(2);
    const second = parseSignInUrl(harness.openedUrls);
    expect(second.state).not.toBe(first.state);
  });

  it("linearizes cancellation after an in-flight credential persistence commit", async () => {
    const persistenceStarted = deferred<void>();
    const releasePersistence = deferred<void>();
    const persistedTokens: string[] = [];
    const harness = createHarness({
      persistToken: async (token) => {
        persistenceStarted.resolve(undefined);
        await releasePersistence.promise;
        persistedTokens.push(token);
      },
    });
    await harness.service.start();
    const signIn = parseSignInUrl(harness.openedUrls);
    const callback = callbackRequest({
      port: signIn.port,
      body: validCallbackBody(signIn.state),
    });
    await persistenceStarted.promise;

    const cancellation = harness.service.cancel();
    await Promise.resolve();
    expect(persistedTokens).toEqual([]);
    expect(harness.completions).toEqual([]);

    releasePersistence.resolve(undefined);
    expect((await callback).status).toBe(200);
    await cancellation;
    expect(persistedTokens).toEqual([VALID_JWT]);
    expect(harness.completions).toEqual([
      {
        ok: true,
        email: "person@example.com",
        name: "Example Person",
      },
    ]);
    await expect(
      callbackRequest({
        port: signIn.port,
        body: validCallbackBody(signIn.state),
      }),
    ).rejects.toThrow();
  });

  it("cannot time out midway through an in-flight credential persistence commit", async () => {
    const persistenceStarted = deferred<void>();
    const releasePersistence = deferred<void>();
    const persistedTokens: string[] = [];
    const harness = createHarness({
      timeoutMs: 25,
      persistToken: async (token) => {
        persistenceStarted.resolve(undefined);
        await releasePersistence.promise;
        persistedTokens.push(token);
      },
    });
    await harness.service.start();
    const signIn = parseSignInUrl(harness.openedUrls);
    const callback = callbackRequest({
      port: signIn.port,
      body: validCallbackBody(signIn.state),
    });
    await persistenceStarted.promise;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(persistedTokens).toEqual([]);
    expect(harness.completions).toEqual([]);

    releasePersistence.resolve(undefined);
    expect((await callback).status).toBe(200);
    await vi.waitFor(() => {
      expect(harness.completions).toEqual([
        {
          ok: true,
          email: "person@example.com",
          name: "Example Person",
        },
      ]);
    });
    expect(persistedTokens).toEqual([VALID_JWT]);
  });

  it("sanitizes network, server, response, and credential-store failures", async () => {
    const scenarios: Array<{
      fetchImpl: typeof fetch;
      persistToken?: (token: string) => Promise<void>;
      expectedError: string;
    }> = [
      {
        fetchImpl: vi.fn(async () => {
          throw new Error("NETWORK_SECRET_CANARY");
        }) as unknown as typeof fetch,
        expectedError: "exchange_failed",
      },
      {
        fetchImpl: vi.fn(async () =>
          jsonResponse({ detail: "SERVER_SECRET_CANARY" }, 500),
        ) as unknown as typeof fetch,
        expectedError: "exchange_failed",
      },
      {
        fetchImpl: vi.fn(
          async () =>
            new Response("<html>PROTOCOL_SECRET_CANARY</html>", {
              status: 200,
              headers: { "content-type": "text/html" },
            }),
        ) as unknown as typeof fetch,
        expectedError: "exchange_failed",
      },
      {
        fetchImpl: vi.fn(async () =>
          jsonResponse({ token: TOKEN_CANARY }),
        ) as unknown as typeof fetch,
        persistToken: async () => {
          throw new Error("KEYCHAIN_SECRET_CANARY");
        },
        expectedError: "persist_failed",
      },
    ];

    for (const scenario of scenarios) {
      const harness = createHarness({
        fetchImpl: scenario.fetchImpl,
        ...(scenario.persistToken ? { persistToken: scenario.persistToken } : {}),
      });
      await harness.service.start();
      const signIn = parseSignInUrl(harness.openedUrls);
      const response = await callbackRequest({
        port: signIn.port,
        body: validCallbackBody(signIn.state),
      });
      expect(response.status).toBe(502);
      expect(harness.completions).toEqual([{ ok: false, error: scenario.expectedError }]);
      const visible = JSON.stringify({
        response: response.body,
        completions: harness.completions,
        openedUrls: harness.openedUrls,
      });
      expect(visible).not.toMatch(
        /NETWORK_SECRET_CANARY|SERVER_SECRET_CANARY|PROTOCOL_SECRET_CANARY|KEYCHAIN_SECRET_CANARY|TOKEN_CANARY/,
      );
    }
  });

  it("times out, cancels, and disposes without leaving listeners active", async () => {
    const timedOut = createHarness({ timeoutMs: 25 });
    await timedOut.service.start();
    const timedOutSignIn = parseSignInUrl(timedOut.openedUrls);
    await vi.waitFor(
      () => {
        expect(timedOut.completions).toEqual([{ ok: false, error: "timeout" }]);
      },
      { timeout: 1000 },
    );
    await expect(
      callbackRequest({
        port: timedOutSignIn.port,
        body: validCallbackBody(timedOutSignIn.state),
      }),
    ).rejects.toThrow();

    const canceled = createHarness();
    await canceled.service.start();
    const canceledSignIn = parseSignInUrl(canceled.openedUrls);
    await canceled.service.cancel();
    expect(canceled.completions).toEqual([]);
    await expect(
      callbackRequest({
        port: canceledSignIn.port,
        body: validCallbackBody(canceledSignIn.state),
      }),
    ).rejects.toThrow();

    await canceled.service.start();
    const disposedSignIn = parseSignInUrl(canceled.openedUrls);
    await canceled.service.dispose();
    await expect(
      callbackRequest({
        port: disposedSignIn.port,
        body: validCallbackBody(disposedSignIn.state),
      }),
    ).rejects.toThrow();
    await expect(canceled.service.start()).rejects.toThrow("Account login service is disposed");
  });

  it("times out even when browser launch never settles", async () => {
    const launch = deferred<void>();
    const harness = createHarness({
      timeoutMs: 25,
      openExternal: (url) => {
        harness.openedUrls.push(url);
        return launch.promise;
      },
    });

    await expect(harness.service.start()).resolves.toEqual({ ok: true });
    const signIn = parseSignInUrl(harness.openedUrls);
    await vi.waitFor(() => {
      expect(harness.completions).toEqual([{ ok: false, error: "timeout" }]);
    });
    launch.reject(new Error("BROWSER_LATE_SECRET_CANARY"));
    await Promise.resolve();

    expect(harness.completions).toEqual([{ ok: false, error: "timeout" }]);
    expect(JSON.stringify(harness.completions)).not.toContain("BROWSER_LATE_SECRET_CANARY");
    await expect(
      callbackRequest({
        port: signIn.port,
        body: validCallbackBody(signIn.state),
      }),
    ).rejects.toThrow();
  });

  it("ignores a stale launch rejection after a newer login succeeds and still disposes a hung launch", async () => {
    const firstLaunch = deferred<void>();
    const thirdLaunch = deferred<void>();
    let launchIndex = 0;
    const harness = createHarness({
      openExternal: (url) => {
        harness.openedUrls.push(url);
        launchIndex += 1;
        if (launchIndex === 1) {
          return firstLaunch.promise;
        }
        if (launchIndex === 2) {
          return undefined;
        }
        return thirdLaunch.promise;
      },
    });

    await harness.service.start();
    const first = parseSignInUrl(harness.openedUrls);
    await expectResolvesWithin(harness.service.cancel(), 250);

    await harness.service.start();
    const second = parseSignInUrl(harness.openedUrls);
    const success = await callbackRequest({
      port: second.port,
      body: validCallbackBody(second.state),
    });
    expect(success.status).toBe(200);
    expect(harness.persistedTokens).toEqual([VALID_JWT]);
    expect(harness.completions).toEqual([
      {
        ok: true,
        email: "person@example.com",
        name: "Example Person",
      },
    ]);

    firstLaunch.reject(new Error("BROWSER_LATE_CANCEL_CANARY"));
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(harness.persistedTokens).toEqual([VALID_JWT]);
    expect(harness.completions).toEqual([
      {
        ok: true,
        email: "person@example.com",
        name: "Example Person",
      },
    ]);
    expect(
      JSON.stringify({
        completions: harness.completions,
        persistedTokens: harness.persistedTokens,
      }),
    ).not.toContain("BROWSER_LATE_CANCEL_CANARY");
    await expect(
      callbackRequest({
        port: first.port,
        body: validCallbackBody(first.state),
      }),
    ).rejects.toThrow();

    await harness.service.start();
    const third = parseSignInUrl(harness.openedUrls);
    await expectResolvesWithin(harness.service.dispose(), 250);
    thirdLaunch.reject(new Error("BROWSER_LATE_DISPOSE_CANARY"));
    await Promise.resolve();
    expect(harness.completions).toEqual([
      {
        ok: true,
        email: "person@example.com",
        name: "Example Person",
      },
    ]);
    await expect(
      callbackRequest({
        port: third.port,
        body: validCallbackBody(third.state),
      }),
    ).rejects.toThrow();
  });

  it("force-closes partial callback bodies on timeout, cancel, and dispose", async () => {
    const timedOut = createHarness({ timeoutMs: 25 });
    await timedOut.service.start();
    const timedOutSignIn = parseSignInUrl(timedOut.openedUrls);
    const timedOutSocket = await partialCallbackSocket({
      port: timedOutSignIn.port,
      state: timedOutSignIn.state,
    });
    await waitForSocketClose(timedOutSocket);
    await vi.waitFor(() => {
      expect(timedOut.completions).toEqual([{ ok: false, error: "timeout" }]);
    });

    const canceled = createHarness();
    await canceled.service.start();
    const canceledSignIn = parseSignInUrl(canceled.openedUrls);
    const canceledSocket = await partialCallbackSocket({
      port: canceledSignIn.port,
      state: canceledSignIn.state,
    });
    const canceledClose = waitForSocketClose(canceledSocket);
    await canceled.service.cancel();
    await canceledClose;

    const disposed = createHarness();
    await disposed.service.start();
    const disposedSignIn = parseSignInUrl(disposed.openedUrls);
    const disposedSocket = await partialCallbackSocket({
      port: disposedSignIn.port,
      state: disposedSignIn.state,
    });
    const disposedClose = waitForSocketClose(disposedSocket);
    await disposed.service.dispose();
    await disposedClose;
  });

  it("fails closed when browser launch fails without exposing URL secrets", async () => {
    const completion: GraftAccountLoginCompletion[] = [];
    const service = new GraftAccountLoginService({
      controlPlaneBaseUrl: "https://control.graft.test",
      openExternal: () => {
        throw new Error("BROWSER_RAW_SECRET_CANARY");
      },
      persistToken: async () => undefined,
      onComplete: (result) => {
        completion.push(result);
      },
    });
    activeServices.push(service);

    await expect(service.start()).rejects.toThrow("Unable to start account login");
    expect(completion).toEqual([{ ok: false, error: "start_failed" }]);
    expect(JSON.stringify(completion)).not.toContain("BROWSER_RAW_SECRET_CANARY");
  });

  it("rejects insecure or ambiguous control-plane base URLs", () => {
    const dependencies = {
      openExternal: () => undefined,
      persistToken: async () => undefined,
      onComplete: () => undefined,
    };
    expect(
      () =>
        new GraftAccountLoginService({
          ...dependencies,
          controlPlaneBaseUrl: "http://control.graft.test",
        }),
    ).toThrow("must use HTTPS");
    expect(
      () =>
        new GraftAccountLoginService({
          ...dependencies,
          controlPlaneBaseUrl: "https://user:password@control.graft.test/path?query=yes",
        }),
    ).toThrow("Invalid control-plane URL");
    expect(
      () =>
        new GraftAccountLoginService({
          ...dependencies,
          controlPlaneBaseUrl: "http://127.0.0.1:8787",
        }),
    ).not.toThrow();
  });
});
