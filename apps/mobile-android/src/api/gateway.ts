import {
  GRAFT_MOBILE_PROTOCOL_VERSION,
  GraftEnvironmentSnapshotSchema,
  GraftPairExchangeErrorSchema,
  GraftPairExchangeRequestSchema,
  GraftPairExchangeResponseSchema,
  GraftRemoteErrorSchema,
  GraftRemoteHealthSchema,
  type GraftEnvironmentSnapshot,
  type GraftPairExchangeRequest,
  type GraftPairingPayload,
  type GraftRemoteErrorCode,
  type GraftRemoteHealth,
  type GraftSessionCredential,
} from "@graft/mobile-contract";
import { fetch as expoFetch } from "expo/fetch";

const REQUEST_TIMEOUT_MS = 20_000;

type GatewayFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class GatewayError extends Error {
  override readonly name = "GatewayError";

  constructor(
    message: string,
    readonly code: GraftRemoteErrorCode | "network" | "invalid_response",
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface PairingClientInfo {
  readonly appVersion: string;
  readonly deviceId: string;
  readonly deviceLabel?: string;
}

export interface GatewayClient {
  health(baseUrl: string): Promise<GraftRemoteHealth>;
  pair(pairing: GraftPairingPayload, client: PairingClientInfo): Promise<GraftSessionCredential>;
  snapshot(session: GraftSessionCredential, threadId?: string): Promise<GraftEnvironmentSnapshot>;
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new GatewayError(
      "The Graft host returned an unreadable response.",
      "invalid_response",
      response.status,
    );
  }
}

function errorFromResponse(response: Response, body: unknown): GatewayError {
  const exchangeError = GraftPairExchangeErrorSchema.safeParse(body);
  if (exchangeError.success) {
    return new GatewayError(
      exchangeError.data.error.message,
      exchangeError.data.error.code,
      response.status,
    );
  }

  const remoteError = GraftRemoteErrorSchema.safeParse(body);
  if (remoteError.success) {
    return new GatewayError(remoteError.data.message, remoteError.data.code, response.status);
  }

  return new GatewayError(
    `The Graft host returned HTTP ${response.status}.`,
    "invalid_response",
    response.status,
  );
}

async function request(fetcher: GatewayFetch, url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "The Graft host did not respond in time."
        : "Could not reach the Graft host. Check that it is awake and online.";
    throw new GatewayError(message, "network");
  } finally {
    clearTimeout(timeout);
  }
}

export function createGatewayClient(fetcher: GatewayFetch = expoFetch): GatewayClient {
  return {
    async health(baseUrl) {
      const response = await request(fetcher, endpoint(baseUrl, "/v1/health"));
      const body = await responseJson(response);
      if (!response.ok) throw errorFromResponse(response, body);

      const parsed = GraftRemoteHealthSchema.safeParse(body);
      if (!parsed.success) {
        throw new GatewayError(
          "This endpoint is not a compatible Graft host.",
          "invalid_response",
          response.status,
        );
      }
      if (!parsed.data.networkAccessEnabled) {
        throw new GatewayError(
          "Remote access is disabled on this Graft host.",
          "host_offline",
          response.status,
        );
      }
      return parsed.data;
    },

    async pair(pairing, client) {
      const body: GraftPairExchangeRequest = GraftPairExchangeRequestSchema.parse({
        token: pairing.token,
        protocolVersion: GRAFT_MOBILE_PROTOCOL_VERSION,
        client: {
          platform: "android",
          appVersion: client.appVersion,
          deviceId: client.deviceId,
          deviceLabel: client.deviceLabel,
        },
      });
      const response = await request(fetcher, endpoint(pairing.host, "/v1/pair"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await responseJson(response);
      if (!response.ok) throw errorFromResponse(response, json);

      const parsed = GraftPairExchangeResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new GatewayError(
          "The Graft host returned an invalid session.",
          "invalid_response",
          response.status,
        );
      }
      return parsed.data.session;
    },

    async snapshot(session, threadId) {
      const url = new URL(endpoint(session.httpBaseUrl, "/v1/snapshot"));
      if (threadId) url.searchParams.set("threadId", threadId);

      const response = await request(fetcher, url.toString(), {
        headers: { authorization: `Bearer ${session.bearerToken}` },
      });
      const body = await responseJson(response);
      if (!response.ok) throw errorFromResponse(response, body);

      const parsed = GraftEnvironmentSnapshotSchema.safeParse(body);
      if (!parsed.success) {
        throw new GatewayError(
          "The Graft host returned an invalid workspace snapshot.",
          "invalid_response",
          response.status,
        );
      }
      return parsed.data;
    },
  };
}
