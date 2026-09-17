import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

export const GRAFT_CONTROL_PLANE_URL = "https://api.graftapp.io";
const DESKTOP_AUTH_VERSION = "2";
const CALLBACK_PATH = "/auth/callback";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_CALLBACK_BODY_BYTES = 2048;
const MAX_EXCHANGE_RESPONSE_BYTES = 32 * 1024;
const CALLBACK_HEADERS_TIMEOUT_MS = 5_000;
const CALLBACK_REQUEST_TIMEOUT_MS = 5_000;
const CALLBACK_KEEP_ALIVE_TIMEOUT_MS = 500;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const SAFE_SUCCESS_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Graft sign-in complete</title></head><body><p>Sign-in complete. You can close this tab and return to Graft.</p></body></html>';
const SAFE_ERROR_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Graft sign-in failed</title></head><body><p>Sign-in could not be completed. Return to Graft and try again.</p></body></html>';

export interface GraftAccountLoginCompletion {
  ok: boolean;
  email?: string;
  name?: string;
  error?: string;
}

export interface GraftAccountLoginServiceDependencies {
  controlPlaneBaseUrl: string;
  openExternal: (url: string) => void | Promise<void>;
  persistToken: (token: string) => Promise<void>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  onComplete: (result: GraftAccountLoginCompletion) => void;
}

interface LoginAttempt {
  generation: number;
  state: string;
  verifier: string;
  server: Server;
  port: number;
  abortController: AbortController;
  timeout: ReturnType<typeof setTimeout> | null;
  closing: Promise<void> | null;
  completed: boolean;
  sockets: Set<Socket>;
}

interface ExchangePayload {
  token: string;
  email?: string;
  name?: string;
}

type RequestValidationResult =
  | { ok: true; grant: string }
  | {
      ok: false;
      status: InvalidRequestStatus;
    };

type InvalidRequestStatus = 400 | 404 | 405 | 411 | 413 | 415;

function randomOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function derivePkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function isOpaqueToken(value: string): boolean {
  return OPAQUE_TOKEN_PATTERN.test(value);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function isJwtLike(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 16 * 1024) {
    return false;
  }
  const parts = value.split(".");
  return (
    parts.length === 3 && parts.every((part) => part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part))
  );
}

export function validateControlPlaneBaseUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid control-plane URL");
  }
  const isLocalDevelopmentUrl =
    parsed.protocol === "http:" &&
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  if (parsed.protocol !== "https:" && !isLocalDevelopmentUrl) {
    throw new Error("Control-plane URL must use HTTPS");
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "" && parsed.pathname !== "/")
  ) {
    throw new Error("Invalid control-plane URL");
  }
  return parsed;
}

function writeHtmlResponse(response: ServerResponse, status: number, html: string): void {
  if (response.headersSent || response.destroyed) {
    return;
  }
  response.writeHead(status, {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy":
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Connection: "close",
  });
  response.end(html);
}

function writeInvalidResponse(response: ServerResponse, status: InvalidRequestStatus): void {
  writeHtmlResponse(response, status, SAFE_ERROR_HTML);
}

async function readRequestBody(
  request: IncomingMessage,
  expectedLength: number,
): Promise<string | null> {
  const chunks: Buffer[] = [];
  let bytesRead = 0;
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytesRead += buffer.length;
      if (bytesRead > MAX_CALLBACK_BODY_BYTES) {
        return null;
      }
      chunks.push(buffer);
    }
  } catch {
    return null;
  }
  if (bytesRead !== expectedLength) {
    return null;
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readAccountResponseBody(response: Response): Promise<string | null> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength &&
    (/^\d+$/.test(declaredLength) === false || Number(declaredLength) > MAX_EXCHANGE_RESPONSE_BYTES)
  ) {
    return null;
  }
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      total += result.value.byteLength;
      if (total > MAX_EXCHANGE_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
  } catch {
    throw new Error("Account response could not be read.");
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseExchangePayload(rawBody: string): ExchangePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (!isJwtLike(record.token)) {
    return null;
  }
  if (
    record.email !== undefined &&
    (typeof record.email !== "string" || record.email.length > 320)
  ) {
    return null;
  }
  if (record.name !== undefined && (typeof record.name !== "string" || record.name.length > 200)) {
    return null;
  }
  return {
    token: record.token,
    ...(typeof record.email === "string" ? { email: record.email } : {}),
    ...(typeof record.name === "string" ? { name: record.name } : {}),
  };
}

export class GraftAccountLoginService {
  private readonly baseUrl: URL;
  private readonly openExternal: (url: string) => void | Promise<void>;
  private readonly persistToken: (token: string) => Promise<void>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly onComplete: (result: GraftAccountLoginCompletion) => void;
  private activeAttempt: LoginAttempt | null = null;
  private generation = 0;
  private disposed = false;
  private lifecycle: Promise<void> = Promise.resolve();

  constructor(dependencies: GraftAccountLoginServiceDependencies) {
    this.baseUrl = validateControlPlaneBaseUrl(dependencies.controlPlaneBaseUrl);
    this.openExternal = dependencies.openExternal;
    this.persistToken = dependencies.persistToken;
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.onComplete = dependencies.onComplete;
    this.timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs <= 0 ||
      this.timeoutMs > 10 * 60 * 1000
    ) {
      throw new Error("Invalid login timeout");
    }
  }

  async start(): Promise<{ ok: true }> {
    return this.enqueue(async () => {
      if (this.disposed) {
        throw new Error("Account login service is disposed");
      }
      const requestedGeneration = this.generation + 1;
      this.generation = requestedGeneration;
      await this.closeActiveAttempt();

      const state = randomOpaqueToken();
      const verifier = randomOpaqueToken();
      const server = createServer();
      server.headersTimeout = CALLBACK_HEADERS_TIMEOUT_MS;
      server.requestTimeout = CALLBACK_REQUEST_TIMEOUT_MS;
      server.keepAliveTimeout = CALLBACK_KEEP_ALIVE_TIMEOUT_MS;
      server.maxRequestsPerSocket = 1;
      const attempt: LoginAttempt = {
        generation: requestedGeneration,
        state,
        verifier,
        server,
        port: 0,
        abortController: new AbortController(),
        timeout: null,
        closing: null,
        completed: false,
        sockets: new Set(),
      };
      server.on("connection", (socket) => {
        attempt.sockets.add(socket);
        socket.setTimeout(CALLBACK_REQUEST_TIMEOUT_MS, () => {
          socket.destroy();
        });
        socket.on("close", () => {
          attempt.sockets.delete(socket);
        });
      });
      server.on("request", (request, response) => {
        void this.handleLoopbackRequest(attempt, request, response);
      });
      this.activeAttempt = attempt;

      try {
        attempt.port = await this.listenOnLoopback(server);
        if (!this.isCurrent(attempt)) {
          await this.closeAttempt(attempt);
          return { ok: true };
        }
        attempt.timeout = setTimeout(() => {
          void this.enqueue(async () => {
            await this.finishAttempt(attempt, {
              ok: false,
              error: "timeout",
            });
          });
        }, this.timeoutMs);

        const signInUrl = new URL("/auth/login", this.baseUrl);
        signInUrl.searchParams.set("callback_port", String(attempt.port));
        signInUrl.searchParams.set("state", state);
        signInUrl.searchParams.set("code_challenge", derivePkceChallenge(verifier));
        signInUrl.searchParams.set("flow_version", DESKTOP_AUTH_VERSION);
        let launchResult: void | Promise<void>;
        try {
          launchResult = this.openExternal(signInUrl.toString());
        } catch {
          await this.finishAttempt(attempt, {
            ok: false,
            error: "start_failed",
          });
          throw new Error("Unable to start account login");
        }
        this.observeExternalLaunch(attempt, launchResult);
        return { ok: true };
      } catch {
        await this.finishAttempt(attempt, {
          ok: false,
          error: "start_failed",
        });
        throw new Error("Unable to start account login");
      }
    });
  }

  private observeExternalLaunch(attempt: LoginAttempt, launchResult: void | Promise<void>): void {
    void Promise.resolve(launchResult).catch(() => {
      void this.enqueue(async () => {
        if (!this.isCurrent(attempt)) {
          return;
        }
        await this.finishAttempt(attempt, {
          ok: false,
          error: "start_failed",
        });
      });
    });
  }

  async cancel(): Promise<void> {
    await this.enqueue(async () => {
      this.generation += 1;
      await this.closeActiveAttempt();
    });
  }

  async dispose(): Promise<void> {
    await this.enqueue(async () => {
      this.generation += 1;
      this.disposed = true;
      await this.closeActiveAttempt();
    });
  }

  private enqueue<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const result = this.lifecycle.then(operation, operation);
    this.lifecycle = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private listenOnLoopback(server: Server): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        if (
          typeof address !== "object" ||
          address === null ||
          address.address !== "127.0.0.1" ||
          address.port < 1
        ) {
          reject(new Error("Loopback listener did not bind safely"));
          return;
        }
        resolve(address.port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(0, "127.0.0.1");
    });
  }

  private isCurrent(attempt: LoginAttempt): boolean {
    return (
      !this.disposed &&
      this.activeAttempt === attempt &&
      this.generation === attempt.generation &&
      !attempt.completed
    );
  }

  private async handleLoopbackRequest(
    attempt: LoginAttempt,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const validation = await this.validateLoopbackRequest(attempt, request);
      if (!validation.ok) {
        writeInvalidResponse(response, validation.status);
        return;
      }
      if (!this.isCurrent(attempt)) {
        writeHtmlResponse(response, 409, SAFE_ERROR_HTML);
        return;
      }

      // The short socket timeout bounds untrusted request uploads. Once validated,
      // allow the bounded login flow to finish its exchange and relay registration.
      request.socket.setTimeout(0);

      const exchangeUrl = new URL("/auth/desktop/exchange", this.baseUrl).toString();
      let exchangeResponse: Response;
      try {
        exchangeResponse = await this.fetchImpl(exchangeUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            grant: validation.grant,
            code_verifier: attempt.verifier,
            flow_version: DESKTOP_AUTH_VERSION,
          }),
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: attempt.abortController.signal,
        });
      } catch {
        await this.enqueue(async () => {
          if (!this.isCurrent(attempt)) {
            writeHtmlResponse(response, 409, SAFE_ERROR_HTML);
            return;
          }
          await this.finishAttempt(attempt, { ok: false, error: "exchange_failed" }, response);
        });
        return;
      }

      const rawBody = await readAccountResponseBody(exchangeResponse);
      if (exchangeResponse.status === 400 || exchangeResponse.status === 401) {
        if (this.isCurrent(attempt)) {
          writeHtmlResponse(response, 400, SAFE_ERROR_HTML);
        } else {
          writeHtmlResponse(response, 409, SAFE_ERROR_HTML);
        }
        return;
      }
      const responseMediaType = (exchangeResponse.headers.get("content-type") ?? "")
        .split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (!exchangeResponse.ok || rawBody === null || responseMediaType !== "application/json") {
        await this.enqueue(async () => {
          if (!this.isCurrent(attempt)) {
            writeHtmlResponse(response, 409, SAFE_ERROR_HTML);
            return;
          }
          await this.finishAttempt(attempt, { ok: false, error: "exchange_failed" }, response);
        });
        return;
      }

      const payload = parseExchangePayload(rawBody);
      if (!payload) {
        await this.enqueue(async () => {
          if (!this.isCurrent(attempt)) {
            writeHtmlResponse(response, 409, SAFE_ERROR_HTML);
            return;
          }
          await this.finishAttempt(attempt, { ok: false, error: "exchange_failed" }, response);
        });
        return;
      }

      await this.enqueue(async () => {
        if (!this.isCurrent(attempt)) {
          writeHtmlResponse(response, 409, SAFE_ERROR_HTML);
          return;
        }
        try {
          await this.persistToken(payload.token);
        } catch {
          await this.finishAttempt(attempt, { ok: false, error: "persist_failed" }, response);
          return;
        }
        await this.finishAttempt(
          attempt,
          {
            ok: true,
            ...(payload.email ? { email: payload.email } : {}),
            ...(payload.name ? { name: payload.name } : {}),
          },
          response,
        );
      });
    } catch {
      await this.enqueue(async () => {
        if (!this.isCurrent(attempt)) {
          writeHtmlResponse(response, 409, SAFE_ERROR_HTML);
          return;
        }
        await this.finishAttempt(attempt, { ok: false, error: "exchange_failed" }, response);
      });
    }
  }

  private async validateLoopbackRequest(
    attempt: LoginAttempt,
    request: IncomingMessage,
  ): Promise<RequestValidationResult> {
    let url: URL;
    try {
      url = new URL(request.url ?? "", `http://127.0.0.1:${attempt.port}`);
    } catch {
      request.resume();
      return { ok: false, status: 400 };
    }
    if (url.pathname !== CALLBACK_PATH || url.search || url.hash) {
      request.resume();
      return { ok: false, status: 404 };
    }
    if (request.method !== "POST") {
      request.resume();
      return { ok: false, status: 405 };
    }
    if (
      request.headers.host !== `127.0.0.1:${attempt.port}` ||
      request.socket.remoteAddress !== "127.0.0.1"
    ) {
      request.resume();
      return { ok: false, status: 400 };
    }
    const contentType = request.headers["content-type"];
    if (typeof contentType !== "string" || contentType.trim().toLowerCase() !== FORM_CONTENT_TYPE) {
      request.resume();
      return { ok: false, status: 415 };
    }
    const contentLength = request.headers["content-length"];
    if (typeof contentLength !== "string" || !/^[1-9]\d*$/.test(contentLength)) {
      request.resume();
      return { ok: false, status: 411 };
    }
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > MAX_CALLBACK_BODY_BYTES) {
      request.resume();
      return { ok: false, status: 413 };
    }

    const body = await readRequestBody(request, declaredBytes);
    if (body === null || body.includes("\0") || /%(?![A-Fa-f0-9]{2})/.test(body)) {
      return { ok: false, status: 400 };
    }
    const params = new URLSearchParams(body);
    const entries = [...params.entries()];
    if (
      entries.length !== 2 ||
      entries.filter(([key]) => key === "grant").length !== 1 ||
      entries.filter(([key]) => key === "state").length !== 1
    ) {
      return { ok: false, status: 400 };
    }
    const grant = params.get("grant");
    const state = params.get("state");
    if (
      grant === null ||
      state === null ||
      !isOpaqueToken(grant) ||
      !constantTimeEqual(state, attempt.state)
    ) {
      return { ok: false, status: 400 };
    }
    return { ok: true, grant };
  }

  private initiateClose(attempt: LoginAttempt, preservedSocket?: Socket): Promise<void> {
    if (attempt.closing) {
      return attempt.closing;
    }
    if (attempt.timeout) {
      clearTimeout(attempt.timeout);
      attempt.timeout = null;
    }
    attempt.abortController.abort();
    attempt.closing = new Promise((resolve) => {
      for (const socket of attempt.sockets) {
        if (socket !== preservedSocket) {
          socket.destroy();
        }
      }
      if (!attempt.server.listening) {
        resolve();
        return;
      }
      attempt.server.close(() => resolve());
    });
    return attempt.closing;
  }

  private async closeAttempt(attempt: LoginAttempt): Promise<void> {
    const close = this.initiateClose(attempt);
    await close;
    if (this.activeAttempt === attempt) {
      this.activeAttempt = null;
    }
  }

  private async closeActiveAttempt(): Promise<void> {
    const attempt = this.activeAttempt;
    if (!attempt) {
      return;
    }
    await this.closeAttempt(attempt);
  }

  private async finishAttempt(
    attempt: LoginAttempt,
    completion: GraftAccountLoginCompletion,
    response?: ServerResponse,
  ): Promise<void> {
    if (!this.isCurrent(attempt)) {
      if (response) {
        writeHtmlResponse(response, 409, SAFE_ERROR_HTML);
      }
      return;
    }
    attempt.completed = true;
    const close = this.initiateClose(attempt, response?.socket ?? undefined);
    if (response) {
      writeHtmlResponse(
        response,
        completion.ok ? 200 : 502,
        completion.ok ? SAFE_SUCCESS_HTML : SAFE_ERROR_HTML,
      );
    }
    await close;
    if (this.activeAttempt === attempt) {
      this.activeAttempt = null;
    }
    try {
      this.onComplete({ ...completion });
    } catch {
      // Renderer delivery is outside the authentication transaction. Never
      // expose secrets or manufacture a second completion on delivery failure.
    }
  }
}
