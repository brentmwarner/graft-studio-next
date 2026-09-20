import { revokePairedAccountAccess } from "./accountDisconnect";
import { writeFileStringAtomically } from "../atomicWrite";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { AuthSessionId } from "@graft/contracts";

import { ServerAuth } from "../auth/Services/ServerAuth";
import { ServerConfig } from "../config";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment";
import { Open } from "../open";
import {
  authenticateDesktopOwner,
  graftOwnerCorsHeaders,
  graftOwnerPreflightResponse,
} from "../graftOwnerHttp";
import { isLoopbackHost, getBoundListenPort } from "../startupAccess";
import { connectionsDevicesFromSessions } from "./connectionsDevices";
import { getIssuedPairing } from "./issuedPairing";
import {
  getMobileLanGatewayPort,
  mobileLanGatewayAdvertisesIpv6,
  setMobileLanGatewayEnabled,
  shouldStartMobileLanGateway,
} from "./lanGateway";
import {
  loadMobileGatewaySettings,
  mobileGatewaySettingsPath,
  saveMobileGatewaySettings,
} from "./mobileGatewaySettings";
import { discoverNetworkEndpoints } from "./networkEndpoints";
import {
  connectMobileRelayAccount,
  connectMobileRelayWithAccount,
  disconnectMobileRelayAccount,
  getMobileRelayEndpoint,
  getMobileRelayStatus,
  setMobileRelayEnabled,
} from "./relayRuntime";

function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return HttpServerResponse.jsonUnsafe(value, { status, headers });
}

async function readJson(request: HttpServerRequest.HttpServerRequest): Promise<unknown> {
  try {
    return await Effect.runPromise(request.json);
  } catch {
    return null;
  }
}

function connectionsEnabled(config: {
  readonly host?: string | undefined;
  readonly publicUrl?: URL | undefined;
}): boolean {
  return (
    config.publicUrl !== undefined ||
    !isLoopbackHost(config.host) ||
    getMobileLanGatewayPort() !== null ||
    getMobileRelayEndpoint() !== null
  );
}

const connectionsHttpRouteLayer = HttpRouter.add(
  "*",
  "/api/graft/connections/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return jsonResponse({ error: "Bad request" }, 400);
    const config = yield* ServerConfig;
    const corsHeaders = graftOwnerCorsHeaders({ request, url, config });
    if (corsHeaders === null) {
      return jsonResponse({ error: "Trusted request origin required." }, 403);
    }
    if (request.method === "OPTIONS") {
      return graftOwnerPreflightResponse(corsHeaders);
    }
    const serverAuth = yield* ServerAuth;
    const authenticated = yield* authenticateDesktopOwner(request, url, config, serverAuth);
    if (authenticated.role !== "owner") {
      return jsonResponse({ error: "Only the owner can manage mobile pairing." }, 403, corsHeaders);
    }
    const respond = (value: unknown, status = 200) => jsonResponse(value, status, corsHeaders);
    const environment = yield* ServerEnvironment;
    const descriptor = yield* environment.getDescriptor;

    if (request.method === "GET" && url.pathname === "/api/graft/connections/status") {
      const clients = yield* serverAuth.listClientSessions(authenticated.sessionId);
      return respond(
        connectionsStatus(config, descriptor.label, descriptor.environmentId, clients),
      );
    }

    if (request.method === "POST" && url.pathname === "/api/graft/connections/enabled") {
      const body = yield* Effect.promise(() => readJson(request));
      const enabled = Boolean(
        body && typeof body === "object" && (body as { enabled?: unknown }).enabled === true,
      );
      if (!shouldStartMobileLanGateway(config) && enabled === false) {
        return respond({ error: "This host is already reachable without the LAN gateway." }, 400);
      }
      const settingsPath = mobileGatewaySettingsPath(config.stateDir);
      const previous = loadMobileGatewaySettings(settingsPath);
      const error = yield* Effect.tryPromise({
        try: async () => {
          if (!enabled) setMobileRelayEnabled(false);
          const port = shouldStartMobileLanGateway(config)
            ? await setMobileLanGatewayEnabled(enabled, previous.preferredPort ?? 0)
            : getMobileLanGatewayPort();
          await saveMobileGatewaySettings(settingsPath, {
            enabled,
            preferredPort: port ?? previous.preferredPort,
          });
          setMobileRelayEnabled(enabled);
        },
        catch: (cause) =>
          cause instanceof Error ? cause : new Error("Could not save connection settings."),
      }).pipe(Effect.match({ onSuccess: () => null, onFailure: (cause) => cause }));
      if (error) {
        return respond({ error: error.message }, 500);
      }
      const clients = yield* serverAuth.listClientSessions(authenticated.sessionId);
      return respond(
        connectionsStatus(config, descriptor.label, descriptor.environmentId, clients),
      );
    }

    if (request.method === "POST" && url.pathname === "/api/graft/connections/account/disconnect") {
      yield* Effect.promise(() => disconnectMobileRelayAccount());
      if (shouldStartMobileLanGateway(config)) {
        yield* Effect.promise(() => setMobileLanGatewayEnabled(false));
        const settingsPath = mobileGatewaySettingsPath(config.stateDir);
        const previous = loadMobileGatewaySettings(settingsPath);
        yield* writeFileStringAtomically({
          filePath: settingsPath,
          contents: JSON.stringify({ enabled: false, preferredPort: previous.preferredPort }),
          mode: 0o600,
        }).pipe(Effect.orDie);
      }
      yield* revokePairedAccountAccess(serverAuth, authenticated.sessionId);
      return respond({ ok: true });
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/graft/connections/relay/connect-account"
    ) {
      const body = yield* Effect.promise(() => readJson(request));
      const accountToken =
        body && typeof body === "object" && "accountToken" in body ? body.accountToken : null;
      if (
        typeof accountToken !== "string" ||
        accountToken.length === 0 ||
        accountToken.length > 16 * 1024
      )
        return respond({ error: "A verified Graft account session is required." }, 400);
      const connected = yield* Effect.tryPromise({
        try: () => connectMobileRelayWithAccount(descriptor.label, accountToken),
        catch: () => new Error("Could not connect the Graft account relay."),
      }).pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));
      return connected
        ? respond({ ok: true })
        : respond({ error: "Could not connect the Graft account relay." }, 400);
    }

    if (request.method === "POST" && url.pathname === "/api/graft/connections/relay/connect") {
      const opener = yield* Open;
      const error = yield* Effect.tryPromise({
        try: () =>
          connectMobileRelayAccount(descriptor.label, (target) =>
            Effect.runPromise(opener.openBrowser(target)),
          ),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }).pipe(Effect.match({ onSuccess: () => null, onFailure: (cause) => cause.message }));
      return error ? respond({ error }, 400) : respond({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/api/graft/connections/revoke-device") {
      const body = yield* Effect.promise(() => readJson(request));
      const deviceId =
        body &&
        typeof body === "object" &&
        typeof (body as { deviceId?: unknown }).deviceId === "string"
          ? (body as { deviceId: string }).deviceId
          : "";
      if (!deviceId) return respond({ error: "Device id is required." }, 400);
      yield* serverAuth.revokeClientSession(
        authenticated.sessionId,
        AuthSessionId.makeUnsafe(deviceId),
      );
      const clients = yield* serverAuth.listClientSessions(authenticated.sessionId);
      return respond(
        connectionsStatus(config, descriptor.label, descriptor.environmentId, clients),
      );
    }

    return respond({ error: "Not found" }, 404);
  }).pipe(
    Effect.catchTag("AuthError", (error) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = HttpServerRequest.toURL(request);
        const config = yield* ServerConfig;
        const headers =
          url === undefined ? {} : (graftOwnerCorsHeaders({ request, url, config }) ?? {});
        return jsonResponse({ error: error.message }, error.status ?? 401, headers);
      }),
    ),
  ),
);

function connectionsStatus(
  config: {
    readonly host?: string | undefined;
    readonly port: number;
    readonly publicUrl?: URL | undefined;
    readonly stateDir: string;
  },
  environmentLabel: string,
  environmentId: string,
  sessions: Parameters<typeof connectionsDevicesFromSessions>[0],
) {
  const enabled = connectionsEnabled(config);
  const advertisedPort = getMobileLanGatewayPort() ?? getBoundListenPort(config.port);
  const relay = getMobileRelayEndpoint();
  const relayStatus = getMobileRelayStatus();
  const endpoints = enabled
    ? [
        ...(relay ? [relay] : []),
        ...discoverNetworkEndpoints(advertisedPort, undefined, {
          includeIpv6: mobileLanGatewayAdvertisesIpv6(),
        }),
      ]
    : [];
  const pairing = getIssuedPairing();
  const devices = connectionsDevicesFromSessions(sessions, environmentLabel);
  const bindHost = getMobileLanGatewayPort() !== null ? "0.0.0.0" : (config.host ?? "127.0.0.1");
  return {
    enabled,
    networkAccessEnabled: enabled,
    environmentId,
    environmentLabel,
    bindHost,
    port: enabled ? advertisedPort : null,
    endpoints: endpoints.map((endpoint) => ({
      kind: endpoint.kind,
      address: endpoint.address,
      interfaceName: endpoint.interfaceName,
      httpBaseUrl: endpoint.httpBaseUrl,
      wsBaseUrl: endpoint.wsBaseUrl,
    })),
    devices,
    pairingUrl: pairing.pairingUrl,
    pairingExpiresAt: pairing.pairingExpiresAt,
    relay: relayStatus,
    diagnostics: [
      `enabled=${enabled}`,
      `environment=${environmentLabel} (${environmentId})`,
      `bind=${bindHost}:${enabled ? advertisedPort : "-"}`,
      `endpoints=${endpoints.map((endpoint) => `${endpoint.kind}:${endpoint.httpBaseUrl}`).join(",") || "-"}`,
      `relay=${relayStatus.state}`,
      `devices=${devices.length}`,
      `pairingExpiresAt=${pairing.pairingExpiresAt ?? "-"}`,
    ].join("\n"),
  };
}

export const graftConnectionsRouteLayer = connectionsHttpRouteLayer;
