import { randomUUID } from "node:crypto";

import {
  DEFAULT_MOBILE_CAPABILITIES,
  GRAFT_MOBILE_PROTOCOL_VERSION,
  GraftMobileClientMessageSchema,
  GraftPairExchangeRequestSchema,
  GraftPushRegistrationRequestSchema,
  buildGraftPairingUrl,
  toWebSocketBaseUrl,
  type GraftPairExchangeRequest,
  type GraftMobileHostMessage,
  type GraftPushRegistrationMetadata,
  type GraftRemoteEndpointKind,
  type GraftRemoteError,
} from "@graft/mobile-contract";
import { DateTime, Effect, FileSystem, Layer, Queue, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { makeEffectAuthRequest } from "../auth/effectHttp";
import { AuthError, ServerAuth } from "../auth/Services/ServerAuth";
import {
  SessionCapacityError,
  SessionCredentialError,
  SessionCredentialService,
} from "../auth/Services/SessionCredentialService";
import { deriveAuthClientMetadata } from "../auth/utils";
import { ServerConfig } from "../config";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { isLoopbackHost, getBoundListenPort, mobilePairingBaseUrl } from "../startupAccess";
import {
  GraftMobileCommandError,
  abortMobileCommand,
  claimMobileCommand,
  closedMobileCommandResponse,
  executeMobileCommand,
  loadMobileSnapshot,
  makeGraftMobileGatewayState,
} from "./gateway";
import { makeGraftMobileLiveEventState, toMobileLiveEvent } from "./liveEvents";
import {
  MOBILE_WS_INBOUND_CAPACITY,
  MOBILE_WS_OUTBOUND_CAPACITY,
  offerMobileOutbound,
} from "./outboundQueue";

const MOBILE_JSON_BODY_MAX_BYTES = 256 * 1024;

interface PushRegistration extends GraftPushRegistrationMetadata {
  readonly sessionId: string;
  readonly apnsToken: string;
}

const gatewayStates = new Map<string, ReturnType<typeof makeGraftMobileGatewayState>>();
const pushRegistrations = new Map<string, PushRegistration>();

function gatewayStateForSession(sessionId: string) {
  const existing = gatewayStates.get(sessionId);
  if (existing) return existing;
  const created = makeGraftMobileGatewayState();
  gatewayStates.set(sessionId, created);
  return created;
}

function remoteError(
  code: GraftRemoteError["code"],
  message: string,
  options: Partial<Pick<GraftRemoteError, "requestId" | "commandId" | "retryable">> = {},
): GraftRemoteError {
  return { code, message, ...options };
}

function errorResponse(error: GraftRemoteError, status: number) {
  return HttpServerResponse.jsonUnsafe(error, { status });
}

function pairErrorResponse(error: GraftRemoteError, status: number) {
  return HttpServerResponse.jsonUnsafe({ ok: false, error }, { status });
}

function authErrorResponse(error: AuthError) {
  const status = error.status ?? 500;
  const code =
    status === 403
      ? "authorization_denied"
      : status === 429
        ? "overload"
        : status >= 500
          ? "internal"
          : "authentication_required";
  return errorResponse(
    remoteError(code, error.message, { retryable: status === 429 || status >= 500 }),
    status,
  );
}

function mobilePlatformMetadata(platform: GraftPairExchangeRequest["client"]["platform"]): {
  readonly deviceType: "desktop" | "mobile";
  readonly os?: string;
} {
  switch (platform) {
    case "ios":
      return { deviceType: "mobile", os: "iOS" };
    case "android":
      return { deviceType: "mobile", os: "Android" };
    case "web":
    case "desktop":
      return { deviceType: "desktop" };
    default: {
      const exhaustivePlatform: never = platform;
      return exhaustivePlatform;
    }
  }
}

function requestHttpBaseUrl(
  request: HttpServerRequest.HttpServerRequest,
  config: {
    readonly host?: string | undefined;
    readonly port: number;
    readonly publicUrl?: URL | undefined;
  },
): string | null {
  const url = HttpServerRequest.toURL(request);
  const fallback = config.publicUrl?.origin ?? url?.origin;
  if (!fallback) return null;
  return mobilePairingBaseUrl({
    host: config.host,
    port: getBoundListenPort(config.port),
    publicUrl: config.publicUrl,
    fallback,
  });
}

function endpointKind(baseUrl: string): GraftRemoteEndpointKind {
  const url = new URL(baseUrl);
  if (url.protocol === "https:") {
    return url.hostname.endsWith(".ts.net") ? "tailnet" : "https";
  }
  return isLoopbackHost(url.hostname) ? "loopback" : "lan";
}

function networkAccessEnabled(config: {
  readonly host?: string | undefined;
  readonly publicUrl?: URL | undefined;
}) {
  return config.publicUrl !== undefined || !isLoopbackHost(config.host);
}

const readJson = (request: HttpServerRequest.HttpServerRequest) => {
  const declaredLength = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MOBILE_JSON_BODY_MAX_BYTES) {
    return Effect.fail(new Error("Request body too large."));
  }
  return request.json.pipe(
    Effect.provideService(
      HttpServerRequest.MaxBodySize,
      FileSystem.Size(MOBILE_JSON_BODY_MAX_BYTES),
    ),
    Effect.mapError(() => new Error("Invalid JSON payload.")),
  );
};

function pairingAuthError(error: AuthError): GraftRemoteError {
  const normalized = error.message.toLowerCase();
  const code = normalized.includes("expired")
    ? "pairing_token_expired"
    : normalized.includes("no longer") || normalized.includes("available")
      ? "pairing_token_replayed"
      : "pairing_token_invalid";
  return remoteError(code, error.message);
}

const graftMobileHttpRouteLayer = HttpRouter.add(
  "*",
  "/v1/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return errorResponse(remoteError("validation_failed", "Bad request."), 400);

    const config = yield* ServerConfig;
    const environment = yield* ServerEnvironment;
    const query = yield* ProjectionSnapshotQuery;
    const serverAuth = yield* ServerAuth;

    if (request.method === "GET" && url.pathname === "/v1/health") {
      const descriptor = yield* environment.getDescriptor;
      const { snapshotSequence } = yield* query.getSnapshotSequence();
      return HttpServerResponse.jsonUnsafe({
        ok: true,
        service: "graft-remote-gateway",
        protocolVersion: GRAFT_MOBILE_PROTOCOL_VERSION,
        capabilities: [...DEFAULT_MOBILE_CAPABILITIES],
        environmentId: descriptor.environmentId,
        environmentLabel: descriptor.label,
        networkAccessEnabled: networkAccessEnabled(config),
        cursor: snapshotSequence,
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/pair") {
      const parsed = GraftPairExchangeRequestSchema.safeParse(yield* readJson(request));
      if (!parsed.success) {
        return pairErrorResponse(
          remoteError("validation_failed", "Invalid mobile pairing request."),
          400,
        );
      }
      const exchange = yield* serverAuth
        .exchangeBootstrapCredentialForBearerSession(parsed.data.token, {
          ...deriveAuthClientMetadata({
            headers: request.headers,
            remoteAddress: request.remoteAddress ?? null,
            ...(parsed.data.client.deviceLabel ? { label: parsed.data.client.deviceLabel } : {}),
          }),
          ...mobilePlatformMetadata(parsed.data.client.platform),
        })
        .pipe(
          Effect.match({
            onFailure: (error) => ({
              ok: false as const,
              response: pairErrorResponse(pairingAuthError(error), error.status ?? 401),
            }),
            onSuccess: (value) => ({ ok: true as const, value }),
          }),
        );
      if (!exchange.ok) return exchange.response;
      const bearerSession = exchange.value;

      const authenticated = yield* serverAuth.authenticateHttpRequest({
        headers: { authorization: `Bearer ${bearerSession.sessionToken}` },
        cookies: {},
        url,
      });
      const descriptor = yield* environment.getDescriptor;
      const httpBaseUrl = requestHttpBaseUrl(request, config);
      if (!httpBaseUrl) {
        return pairErrorResponse(
          remoteError("internal", "Could not resolve the mobile gateway address."),
          500,
        );
      }
      const deviceId = parsed.data.client.deviceId ?? randomUUID();
      return HttpServerResponse.jsonUnsafe({
        ok: true,
        session: {
          sessionId: authenticated.sessionId,
          deviceId,
          bearerToken: bearerSession.sessionToken,
          environmentId: descriptor.environmentId,
          environmentLabel: descriptor.label,
          httpBaseUrl,
          wsBaseUrl: toWebSocketBaseUrl(httpBaseUrl),
          protocolVersion: GRAFT_MOBILE_PROTOCOL_VERSION,
          capabilities: [...DEFAULT_MOBILE_CAPABILITIES],
          expiresAt: DateTime.toEpochMillis(bearerSession.expiresAt),
          endpointKind: endpointKind(httpBaseUrl),
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/v1/snapshot") {
      yield* serverAuth.authenticateHttpRequest(makeEffectAuthRequest(request));
      const threadId = url.searchParams.get("threadId")?.trim() || undefined;
      return HttpServerResponse.jsonUnsafe(yield* loadMobileSnapshot(threadId));
    }

    if (request.method === "POST" && url.pathname === "/v1/pairing-link") {
      const authenticated = yield* serverAuth.authenticateHttpRequest(
        makeEffectAuthRequest(request),
      );
      if (authenticated.role !== "owner") {
        return errorResponse(
          remoteError("authorization_denied", "Only the owner can create mobile pairing links."),
          403,
        );
      }
      const httpBaseUrl = requestHttpBaseUrl(request, config);
      if (!httpBaseUrl) {
        return errorResponse(
          remoteError("internal", "Could not resolve the mobile gateway address."),
          500,
        );
      }
      const issued = yield* serverAuth.issuePairingCredential({
        label: "Graft mobile",
        role: "client",
      });
      return HttpServerResponse.jsonUnsafe({
        pairingUrl: buildGraftPairingUrl({
          v: GRAFT_MOBILE_PROTOCOL_VERSION,
          host: httpBaseUrl,
          token: issued.credential,
          label: (yield* environment.getDescriptor).label,
          endpointKind: endpointKind(httpBaseUrl),
        }),
        expiresAt: DateTime.toEpochMillis(issued.expiresAt),
      });
    }

    if (request.method === "PUT" && url.pathname === "/v1/push-registration") {
      const authenticated = yield* serverAuth.authenticateHttpRequest(
        makeEffectAuthRequest(request),
      );
      const parsed = GraftPushRegistrationRequestSchema.safeParse(yield* readJson(request));
      if (!parsed.success) {
        return errorResponse(remoteError("validation_failed", "Invalid push registration."), 400);
      }
      const previous = pushRegistrations.get(authenticated.sessionId);
      const now = Date.now();
      const registration: PushRegistration = {
        sessionId: authenticated.sessionId,
        deviceId: authenticated.sessionId,
        apnsToken: parsed.data.apnsToken,
        apnsEnvironment: parsed.data.apnsEnvironment,
        bundleId: parsed.data.bundleId,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      pushRegistrations.set(authenticated.sessionId, registration);
      const { sessionId: _sessionId, apnsToken: _apnsToken, ...metadata } = registration;
      return HttpServerResponse.jsonUnsafe({ ok: true, registration: metadata });
    }

    if (request.method === "DELETE" && url.pathname === "/v1/push-registration") {
      const authenticated = yield* serverAuth.authenticateHttpRequest(
        makeEffectAuthRequest(request),
      );
      return HttpServerResponse.jsonUnsafe({
        ok: true,
        removed: pushRegistrations.delete(authenticated.sessionId),
      });
    }

    return HttpServerResponse.text("Not Found", { status: 404 });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        error instanceof AuthError
          ? authErrorResponse(error)
          : errorResponse(
              remoteError(
                "internal",
                error instanceof Error ? error.message : "Mobile gateway request failed.",
              ),
              500,
            ),
      ),
    ),
  ),
);

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

const graftMobileWebSocketRouteLayer = HttpRouter.add(
  "GET",
  "/v1/ws",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const serverAuth = yield* ServerAuth;
    const sessions = yield* SessionCredentialService;
    const environment = yield* ServerEnvironment;
    const engine = yield* OrchestrationEngineService;
    const authenticated = yield* serverAuth.authenticateWebSocketUpgrade(
      makeEffectAuthRequest(request),
    );
    return yield* sessions.runAuthenticatedConnection(
      authenticated.sessionId,
      Effect.gen(function* () {
        const gatewayState = gatewayStateForSession(authenticated.sessionId);
        const socket = yield* request.upgrade;
        const writer = yield* socket.writer;
        const inbound = yield* Queue.dropping<unknown>(MOBILE_WS_INBOUND_CAPACITY);
        const outbound = yield* Queue.dropping<string>(MOBILE_WS_OUTBOUND_CAPACITY);
        const liveState = makeGraftMobileLiveEventState();
        const ownedCommandIds = new Set<string>();
        let welcomed = false;

        const send = (message: GraftMobileHostMessage) => offerMobileOutbound(outbound, message);

        yield* Stream.fromQueue(outbound).pipe(Stream.runForEach(writer), Effect.forkScoped);

        const domainEvents = yield* engine.subscribeDomainEvents;
        yield* domainEvents.pipe(
          Stream.runForEach((event) => {
            if (!welcomed) return Effect.void;
            const mobileEvent = toMobileLiveEvent(liveState, event);
            return mobileEvent
              ? send({ envelope: "event", event: mobileEvent })
              : send({
                  envelope: "snapshot_required",
                  reason: "resync",
                  message: "Workspace state changed.",
                });
          }),
          Effect.forkScoped,
        );

        const handleFrame = (raw: unknown) =>
          Effect.gen(function* () {
            const parsed = GraftMobileClientMessageSchema.safeParse(decodeSocketMessage(raw));
            if (!parsed.success) {
              yield* send({
                envelope: "error",
                error: remoteError("validation_failed", "Invalid mobile gateway message."),
              });
              return;
            }
            const message = parsed.data;
            if (message.envelope === "hello") {
              if (message.sessionId !== authenticated.sessionId) {
                yield* send({
                  envelope: "error",
                  error: remoteError(
                    "authorization_denied",
                    "The mobile session does not match this connection.",
                  ),
                });
                return;
              }
              const descriptor = yield* environment.getDescriptor;
              const cursor = yield* engine.getEventHighWaterSequence;
              welcomed = true;
              yield* send({
                envelope: "welcome",
                protocolVersion: GRAFT_MOBILE_PROTOCOL_VERSION,
                capabilities: [...DEFAULT_MOBILE_CAPABILITIES],
                environmentId: descriptor.environmentId,
                environmentLabel: descriptor.label,
                cursor,
              });
              return;
            }
            if (!welcomed) {
              yield* send({
                envelope: "error",
                error: remoteError("authentication_required", "Send hello before other messages."),
              });
              return;
            }
            if (message.envelope === "ping") {
              yield* send({ envelope: "pong", at: message.at });
              return;
            }
            if (message.envelope === "subscribe") return;

            const claimed = claimMobileCommand(gatewayState, message.commandId);
            if (claimed.kind === "cached") {
              yield* send(claimed.response);
              return;
            }
            if (claimed.kind === "pending") {
              yield* send(yield* Effect.promise(() => claimed.promise));
              return;
            }
            ownedCommandIds.add(message.commandId);
            const response = yield* executeMobileCommand(
              gatewayState,
              message.commandId,
              message.command,
            ).pipe(
              Effect.flatMap((result) =>
                engine.getEventHighWaterSequence.pipe(
                  Effect.map(
                    (cursor): GraftMobileHostMessage => ({
                      envelope: "response",
                      commandId: message.commandId,
                      ...(message.requestId ? { requestId: message.requestId } : {}),
                      receipt: {
                        commandId: message.commandId,
                        status: "completed",
                        ...(message.requestId ? { requestId: message.requestId } : {}),
                        cursor,
                      },
                      result,
                    }),
                  ),
                ),
              ),
              Effect.catch((error) => {
                const commandError =
                  error instanceof GraftMobileCommandError
                    ? error
                    : new GraftMobileCommandError({
                        code: "internal",
                        message: error instanceof Error ? error.message : "Mobile command failed.",
                        cause: error,
                      });
                return Effect.succeed<GraftMobileHostMessage>({
                  envelope: "response",
                  commandId: message.commandId,
                  ...(message.requestId ? { requestId: message.requestId } : {}),
                  receipt: {
                    commandId: message.commandId,
                    status: "rejected",
                    ...(message.requestId ? { requestId: message.requestId } : {}),
                    errorCode: commandError.code,
                    message: commandError.message,
                  },
                });
              }),
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  abortMobileCommand(
                    gatewayState,
                    message.commandId,
                    closedMobileCommandResponse(message.commandId),
                  );
                  ownedCommandIds.delete(message.commandId);
                }),
              ),
            );
            claimed.complete(response);
            ownedCommandIds.delete(message.commandId);
            yield* send(response);
          });

        yield* Stream.fromQueue(inbound).pipe(Stream.runForEach(handleFrame), Effect.forkScoped);
        yield* socket
          .run((message) => {
            Effect.runFork(Queue.offer(inbound, message).pipe(Effect.asVoid));
          })
          .pipe(
            Effect.ensuring(
              Effect.sync(() => {
                for (const commandId of ownedCommandIds) {
                  abortMobileCommand(
                    gatewayState,
                    commandId,
                    closedMobileCommandResponse(commandId),
                  );
                }
                ownedCommandIds.clear();
              }),
            ),
          );
        return HttpServerResponse.empty();
      }),
    );
  }).pipe(
    Effect.catch((error) => {
      if (error instanceof AuthError) return Effect.succeed(authErrorResponse(error));
      if (error instanceof SessionCapacityError) {
        return Effect.succeed(
          HttpServerResponse.text(error.message, {
            status: 429,
            headers: {
              "Cache-Control": "no-store",
              "Retry-After": String(error.retryAfterSeconds),
            },
          }),
        );
      }
      if (error instanceof SessionCredentialError) {
        return Effect.succeed(HttpServerResponse.text(error.message, { status: 401 }));
      }
      return Effect.succeed(
        HttpServerResponse.text("Mobile gateway connection failed", { status: 500 }),
      );
    }),
  ),
);

export const graftMobileRouteLayer = Layer.mergeAll(
  graftMobileWebSocketRouteLayer,
  graftMobileHttpRouteLayer,
);
