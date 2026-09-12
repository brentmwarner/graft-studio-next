import { AuthSessionId } from "@synara/contracts";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { makeEffectAuthRequest } from "./auth/effectHttp";
import {
  AuthError,
  type AuthenticatedHttpSession,
  type ServerAuthShape,
} from "./auth/Services/ServerAuth";
import type { ServerConfigShape } from "./config";
import { isLegacyTokenAuthorized } from "./http";
import { isLoopbackHost } from "./startupAccess";
import { isTrustedAppOrigin, normalizeCorsOrigin } from "./trustedOrigins";

const DESKTOP_LEGACY_OWNER_SESSION: AuthenticatedHttpSession = {
  sessionId: AuthSessionId.makeUnsafe("desktop-legacy-token"),
  subject: "desktop-bootstrap",
  method: "bearer-session-token",
  role: "owner",
  credentialSource: "bearer",
};

export function graftOwnerCorsHeaders(input: {
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly url: URL;
  readonly config: ServerConfigShape;
}): Record<string, string> | null {
  const origin = normalizeCorsOrigin(input.request.headers.origin);
  if (!origin) return {};
  const trusted =
    isTrustedAppOrigin({
      origin,
      requestOrigin: input.url.origin,
      config: input.config,
    }) || isLoopbackDesktopRendererOrigin(origin, input.config);
  if (!trusted) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function isLoopbackDesktopRendererOrigin(origin: string, config: ServerConfigShape): boolean {
  if (!isLoopbackHost(config.host) || config.publicUrl) return false;
  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function authenticateDesktopOwner(
  request: HttpServerRequest.HttpServerRequest,
  url: URL,
  config: ServerConfigShape,
  serverAuth: Pick<ServerAuthShape, "authenticateHttpRequest">,
): Effect.Effect<AuthenticatedHttpSession, AuthError> {
  if (isLegacyTokenAuthorized({ config, url })) {
    return Effect.succeed(DESKTOP_LEGACY_OWNER_SESSION);
  }
  return serverAuth.authenticateHttpRequest(makeEffectAuthRequest(request));
}

export function graftOwnerPreflightResponse(headers: Record<string, string>) {
  return HttpServerResponse.empty({ status: 204, headers });
}
