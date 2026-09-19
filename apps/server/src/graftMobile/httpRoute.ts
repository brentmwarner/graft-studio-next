import { randomUUID } from "node:crypto";

import { ThreadId, type OrchestrationEvent } from "@graft/contracts";
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
import { DateTime, Effect, FileSystem, Layer, Option, Queue, Semaphore, Stream } from "effect";
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
import { attachmentPrincipalForSession } from "../managedAttachmentPrincipal";
import { isLoopbackHost, getBoundListenPort, mobilePairingBaseUrl } from "../startupAccess";
import {
  authenticateDesktopOwner,
  graftOwnerCorsHeaders,
  graftOwnerPreflightResponse,
} from "../graftOwnerHttp";
import {
  GraftMobileCommandError,
  claimMobileCommand,
  executeMobileCommand,
  loadMobileSnapshot,
  loadMobileUsage,
  makeGraftMobileGatewayState,
} from "./gateway";
import { makeMobileCommandDispatcher } from "./commandDispatch";
import { getMobileLanGatewayPort, mobileLanGatewayAdvertisesIpv6 } from "./lanGateway";
import {
  isHiddenStudioMobileEvent,
  isStudioProjectKind,
  rememberHiddenStudioFromEvent,
  rememberHiddenStudioFromShell,
} from "./protocolAdapter";
import {
  makeGraftMobileLiveEventState,
  seedGraftMobileLiveEventState,
  toMobileLiveEvent,
} from "./liveEvents";
import {
  discoverNetworkEndpoints,
  preferredPairingEndpoint,
  resolveAdvertisedMobilePairingBase,
} from "./networkEndpoints";
import { rememberIssuedPairing } from "./issuedPairing";
import { getMobileRelayEndpoint, waitForMobileRelayPairing } from "./relayRuntime";
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

function errorResponse(error: GraftRemoteError, status: number, headers?: Record<string, string>) {
  return HttpServerResponse.jsonUnsafe(error, { status, ...(headers ? { headers } : {}) });
}

function pairErrorResponse(error: GraftRemoteError, status: number) {
  return HttpServerResponse.jsonUnsafe({ ok: false, error }, { status });
}

function authErrorResponse(error: AuthError, headers?: Record<string, string>) {
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
    headers,
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

function networkAccessEnabled(config: {
  readonly host?: string | undefined;
  readonly publicUrl?: URL | undefined;
}) {
  return (
    config.publicUrl !== undefined ||
    !isLoopbackHost(config.host) ||
    getMobileLanGatewayPort() !== null ||
    getMobileRelayEndpoint() !== null
  );
}

function advertisedMobilePairingBase(
  request: HttpServerRequest.HttpServerRequest,
  config: {
    readonly host?: string | undefined;
    readonly port: number;
    readonly publicUrl?: URL | undefined;
  },
): { readonly httpBaseUrl: string; readonly endpointKind: GraftRemoteEndpointKind } | null {
  const advertisedPort = getMobileLanGatewayPort() ?? getBoundListenPort(config.port);
  const preferred = preferredPairingEndpoint(
    discoverNetworkEndpoints(advertisedPort, undefined, {
      includeIpv6: mobileLanGatewayAdvertisesIpv6(),
    }),
  );
  return resolveAdvertisedMobilePairingBase({
    relay: getMobileRelayEndpoint(),
    publicUrl: config.publicUrl,
    preferred,
    requestHttpBaseUrl: requestHttpBaseUrl(request, config),
  });
}

function prepareMobilePairingBase(...args: Parameters<typeof advertisedMobilePairingBase>) {
  return Effect.tryPromise({
    try: async () => {
      await waitForMobileRelayPairing();
      const advertised = advertisedMobilePairingBase(...args);
      if (!advertised) throw new Error("Could not resolve the mobile gateway address.");
      return { advertised, error: null };
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  }).pipe(Effect.catch((error) => Effect.succeed({ advertised: null, error: error.message })));
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
      const { advertised, error } = yield* prepareMobilePairingBase(request, config);
      if (!advertised) {
        return pairErrorResponse(remoteError("host_offline", error!, { retryable: true }), 503);
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
      const deviceId = parsed.data.client.deviceId ?? randomUUID();
      return HttpServerResponse.jsonUnsafe({
        ok: true,
        session: {
          sessionId: authenticated.sessionId,
          deviceId,
          bearerToken: bearerSession.sessionToken,
          environmentId: descriptor.environmentId,
          environmentLabel: descriptor.label,
          httpBaseUrl: advertised.httpBaseUrl,
          wsBaseUrl: toWebSocketBaseUrl(advertised.httpBaseUrl),
          protocolVersion: GRAFT_MOBILE_PROTOCOL_VERSION,
          capabilities: [...DEFAULT_MOBILE_CAPABILITIES],
          expiresAt: DateTime.toEpochMillis(bearerSession.expiresAt),
          endpointKind: advertised.endpointKind,
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/v1/snapshot") {
      yield* serverAuth.authenticateHttpRequest(makeEffectAuthRequest(request));
      const threadId = url.searchParams.get("threadId")?.trim() || undefined;
      return HttpServerResponse.jsonUnsafe(yield* loadMobileSnapshot(threadId));
    }

    if (request.method === "GET" && url.pathname === "/v1/usage") {
      yield* serverAuth.authenticateHttpRequest(makeEffectAuthRequest(request));
      const threadId = url.searchParams.get("threadId")?.trim();
      if (!threadId || threadId.length > 512) {
        return errorResponse(remoteError("validation_failed", "A thread ID is required."), 400);
      }
      return yield* loadMobileUsage(threadId).pipe(
        Effect.map((usage) =>
          HttpServerResponse.jsonUnsafe(usage, { headers: { "cache-control": "no-store" } }),
        ),
        Effect.catch((error) =>
          Effect.succeed(
            errorResponse(
              remoteError(
                error instanceof GraftMobileCommandError ? error.code : "internal",
                "Could not load thread usage.",
              ),
              error instanceof GraftMobileCommandError && error.code === "not_found" ? 404 : 500,
            ),
          ),
        ),
      );
    }

    if (url.pathname === "/v1/pairing-link") {
      const corsHeaders = graftOwnerCorsHeaders({ request, url, config });
      if (corsHeaders === null) {
        return errorResponse(
          remoteError("authorization_denied", "Trusted request origin required."),
          403,
        );
      }
      if (request.method === "OPTIONS") {
        return graftOwnerPreflightResponse(corsHeaders);
      }
      if (request.method !== "POST") {
        return errorResponse(
          remoteError("validation_failed", "Method Not Allowed"),
          405,
          corsHeaders,
        );
      }
      const authResult = yield* authenticateDesktopOwner(request, url, config, serverAuth).pipe(
        Effect.catchTag("AuthError", (error) => Effect.succeed({ pairingLinkAuthError: error })),
      );
      if ("pairingLinkAuthError" in authResult) {
        return authErrorResponse(authResult.pairingLinkAuthError, corsHeaders);
      }
      const authenticated = authResult;
      if (authenticated.role !== "owner") {
        return errorResponse(
          remoteError("authorization_denied", "Only the owner can create mobile pairing links."),
          403,
          corsHeaders,
        );
      }
      const { advertised, error } = yield* prepareMobilePairingBase(request, config);
      if (!advertised) {
        return errorResponse(
          remoteError("host_offline", error!, { retryable: true }),
          503,
          corsHeaders,
        );
      }
      const issued = yield* serverAuth.issuePairingCredential({
        label: "Graft mobile",
        role: "client",
      });
      const pairingUrl = buildGraftPairingUrl({
        v: GRAFT_MOBILE_PROTOCOL_VERSION,
        host: advertised.httpBaseUrl,
        token: issued.credential,
        label: (yield* environment.getDescriptor).label,
        endpointKind: advertised.endpointKind,
      });
      const expiresAt = DateTime.toEpochMillis(issued.expiresAt);
      rememberIssuedPairing({ pairingUrl, expiresAt });
      return HttpServerResponse.jsonUnsafe(
        {
          pairingUrl,
          expiresAt,
        },
        { headers: corsHeaders },
      );
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
    const query = yield* ProjectionSnapshotQuery;
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
        const outboundLock = yield* Semaphore.make(1);
        const liveState = makeGraftMobileLiveEventState();
        const dispatchCommand = makeMobileCommandDispatcher();
        const hiddenStudio = {
          studioProjectIds: new Set<string>(),
          studioThreadIds: new Set<string>(),
        };
        let welcomed = false;

        const send = (message: GraftMobileHostMessage) =>
          offerMobileOutbound(outbound, message, outboundLock);

        yield* Stream.fromQueue(outbound).pipe(Stream.runForEach(writer), Effect.forkScoped);

        const refreshHiddenStudio = Effect.gen(function* () {
          const shell = yield* query
            .getShellSnapshot()
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!shell) return;
          rememberHiddenStudioFromShell(shell.projects, shell.threads, hiddenStudio);
        });
        yield* refreshHiddenStudio;

        const shouldHideStudioEvent = (event: OrchestrationEvent) =>
          Effect.gen(function* () {
            rememberHiddenStudioFromEvent(event, hiddenStudio);
            if (isHiddenStudioMobileEvent(event, hiddenStudio)) {
              return true;
            }
            if (event.aggregateKind !== "thread") {
              return false;
            }
            const threadId = String(event.aggregateId);
            const thread = yield* query
              .getThreadShellById(ThreadId.makeUnsafe(threadId))
              .pipe(Effect.catch(() => Effect.succeed(Option.none())));
            if (Option.isNone(thread)) {
              return false;
            }
            if (hiddenStudio.studioProjectIds.has(thread.value.projectId)) {
              hiddenStudio.studioThreadIds.add(thread.value.id);
              return true;
            }
            const project = yield* query
              .getProjectShellById(thread.value.projectId)
              .pipe(Effect.catch(() => Effect.succeed(Option.none())));
            if (Option.isSome(project) && isStudioProjectKind(project.value)) {
              hiddenStudio.studioProjectIds.add(project.value.id);
              hiddenStudio.studioThreadIds.add(thread.value.id);
              return true;
            }
            return false;
          });

        const domainEvents = yield* engine.subscribeDomainEvents;
        yield* domainEvents.pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              if (!welcomed) return;
              if (yield* shouldHideStudioEvent(event)) {
                return;
              }
              if (
                event.type === "thread.message-sent" &&
                event.payload.role === "assistant" &&
                !liveState.snapshotCursorByThreadId.has(event.payload.threadId)
              ) {
                const snapshot = yield* query
                  .getThreadDetailSnapshotById(event.payload.threadId)
                  .pipe(Effect.catch(() => Effect.succeed(Option.none())));
                if (Option.isNone(snapshot)) {
                  yield* send({
                    envelope: "snapshot_required",
                    reason: "resync",
                    message: "Refreshing the conversation.",
                  });
                  return;
                }
                seedGraftMobileLiveEventState(liveState, snapshot.value);
                if (snapshot.value.snapshotSequence >= event.sequence) {
                  // The projection already includes this frame. Send its full
                  // message now so the first chunk is visible without losing a
                  // reconnect prefix or appending the covered delta twice.
                  const message = snapshot.value.thread.messages.find(
                    (candidate) => candidate.id === event.payload.messageId,
                  );
                  if (message) {
                    yield* send({
                      envelope: "event",
                      event: {
                        id: message.id,
                        cursor: event.sequence,
                        threadId: event.payload.threadId,
                        kind: message.streaming ? "assistant.delta" : "assistant.message",
                        createdAt: Date.parse(message.createdAt),
                        ...(!message.streaming
                          ? { completedAt: Date.parse(message.updatedAt) }
                          : {}),
                        text: message.text,
                        ...(message.turnId ? { runId: message.turnId } : {}),
                      },
                    });
                  }
                  yield* send({
                    envelope: "snapshot_required",
                    reason: "resync",
                    message: "Refreshing the conversation.",
                  });
                  return;
                }
              }
              const mobileEvent = toMobileLiveEvent(liveState, event);
              yield* mobileEvent
                ? send({ envelope: "event", event: mobileEvent })
                : send({
                    envelope: "snapshot_required",
                    reason: "resync",
                    message: "Workspace state changed.",
                  });
            }),
          ),
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
              yield* refreshHiddenStudio;
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

            yield* dispatchCommand(
              message.command,
              Effect.gen(function* () {
                const claimed = claimMobileCommand(gatewayState, message.commandId);
                if (claimed.kind === "reserved") {
                  yield* executeMobileCommand(gatewayState, message.commandId, message.command, {
                    attachmentPrincipal: attachmentPrincipalForSession(authenticated.sessionId),
                  }).pipe(
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
                              message:
                                error instanceof Error ? error.message : "Mobile command failed.",
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
                    Effect.tap((response) => Effect.sync(() => claimed.complete(response))),
                    Effect.uninterruptible,
                    Effect.forkDetach,
                  );
                }
                const response =
                  claimed.kind === "cached"
                    ? claimed.response
                    : yield* Effect.promise(() => claimed.promise);
                yield* send(response);
              }),
              send({
                envelope: "response",
                commandId: message.commandId,
                ...(message.requestId ? { requestId: message.requestId } : {}),
                receipt: {
                  commandId: message.commandId,
                  status: "rejected",
                  errorCode: "overload",
                  message: "Too many mobile reads are pending. Try again shortly.",
                },
              }),
            );
          });

        yield* Stream.fromQueue(inbound).pipe(Stream.runForEach(handleFrame), Effect.forkScoped);
        yield* socket.run((message) => {
          Effect.runFork(Queue.offer(inbound, message).pipe(Effect.asVoid));
        });
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
