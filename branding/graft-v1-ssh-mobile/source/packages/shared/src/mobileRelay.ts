import { z } from "zod";

/**
 * Graft managed mobile relay (v1).
 *
 * The relay is a dumb authenticated byte-pipe between a phone and a desktop
 * host that dials *out*. The phone speaks the unmodified mobile remote
 * protocol (`/v1/health`, `/v1/pair`, `/v1/snapshot`, `/v1/ws`) against
 * `https://relay…/e/{environmentId}`; the relay multiplexes those requests
 * over the single uplink socket the desktop opened.
 *
 * Invariants:
 * - The relay never interprets, logs, or persists request/response bodies.
 *   Frames carry opaque base64 payloads and are dropped once forwarded.
 * - Pairing tokens and session bearers stay end-to-end between phone and
 *   desktop. The relay only authenticates the *uplink* with its own secret.
 * - Every multiplexed exchange is addressed by `requestId` (HTTP) or
 *   `streamId` (WebSocket), both minted by the relay.
 */

export const GRAFT_RELAY_PROTOCOL_VERSION = 1 as const;

/** Uplink socket the desktop dials out to. */
export const GRAFT_RELAY_UPLINK_PATH = "/relay/v1/uplink";

/** Account-authenticated environment registration. */
export const GRAFT_RELAY_ENVIRONMENTS_PATH = "/relay/v1/environments";

/** Public prefix the phone talks to: `/e/{environmentId}/v1/...`. */
export const GRAFT_RELAY_ENVIRONMENT_PREFIX = "/e";

export const GraftRelayHeadersSchema = z.record(z.string(), z.string());
export type GraftRelayHeaders = z.infer<typeof GraftRelayHeadersSchema>;

const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, "expected base64");

const RegisterFrameSchema = z.object({
  type: z.literal("register"),
  protocolVersion: z.literal(GRAFT_RELAY_PROTOCOL_VERSION),
  environmentId: z.string().min(1),
  uplinkSecret: z.string().min(16),
});

const RegisteredFrameSchema = z.object({
  type: z.literal("registered"),
  environmentId: z.string().min(1),
  httpBaseUrl: z.string().url(),
  wsBaseUrl: z.string().url(),
});

const RegisterFailedFrameSchema = z.object({
  type: z.literal("register-failed"),
  reason: z.enum([
    "unauthorized",
    "unknown_environment",
    "revoked",
    "protocol_unsupported",
    "malformed",
  ]),
});

const HttpRequestFrameSchema = z.object({
  type: z.literal("http"),
  requestId: z.string().min(1),
  method: z.string().min(1),
  /** Path plus query, relative to the environment prefix (e.g. `/v1/health`). */
  path: z.string().min(1),
  headers: GraftRelayHeadersSchema,
  bodyBase64: base64.optional(),
});

const HttpResponseFrameSchema = z.object({
  type: z.literal("http-response"),
  requestId: z.string().min(1),
  status: z.number().int().min(100).max(599),
  headers: GraftRelayHeadersSchema,
  bodyBase64: base64.optional(),
});

const WsOpenFrameSchema = z.object({
  type: z.literal("ws-open"),
  streamId: z.string().min(1),
  path: z.string().min(1),
  headers: GraftRelayHeadersSchema,
});

const WsOpenedFrameSchema = z.object({
  type: z.literal("ws-opened"),
  streamId: z.string().min(1),
});

const WsOpenFailedFrameSchema = z.object({
  type: z.literal("ws-open-failed"),
  streamId: z.string().min(1),
  reason: z.string().min(1).max(256).optional(),
});

const WsFrameSchema = z.object({
  type: z.literal("ws-frame"),
  streamId: z.string().min(1),
  dataBase64: base64,
  binary: z.boolean().optional(),
});

const WsCloseFrameSchema = z.object({
  type: z.literal("ws-close"),
  streamId: z.string().min(1),
  code: z.number().int().min(1000).max(4999).optional(),
  reason: z.string().max(123).optional(),
});

/** Desktop host → relay. */
export const GraftRelayUplinkFrameSchema = z.discriminatedUnion("type", [
  RegisterFrameSchema,
  HttpResponseFrameSchema,
  WsOpenedFrameSchema,
  WsOpenFailedFrameSchema,
  WsFrameSchema,
  WsCloseFrameSchema,
]);
export type GraftRelayUplinkFrame = z.infer<typeof GraftRelayUplinkFrameSchema>;

/** Relay → desktop host. */
export const GraftRelayDownlinkFrameSchema = z.discriminatedUnion("type", [
  RegisteredFrameSchema,
  RegisterFailedFrameSchema,
  HttpRequestFrameSchema,
  WsOpenFrameSchema,
  WsFrameSchema,
  WsCloseFrameSchema,
]);
export type GraftRelayDownlinkFrame = z.infer<
  typeof GraftRelayDownlinkFrameSchema
>;

export type GraftRelayRegisterFrame = z.infer<typeof RegisterFrameSchema>;
export type GraftRelayRegisteredFrame = z.infer<typeof RegisteredFrameSchema>;
export type GraftRelayRegisterFailedFrame = z.infer<
  typeof RegisterFailedFrameSchema
>;
export type GraftRelayHttpRequestFrame = z.infer<typeof HttpRequestFrameSchema>;
export type GraftRelayHttpResponseFrame = z.infer<
  typeof HttpResponseFrameSchema
>;
export type GraftRelayWsOpenFrame = z.infer<typeof WsOpenFrameSchema>;
export type GraftRelayWsFrame = z.infer<typeof WsFrameSchema>;
export type GraftRelayWsCloseFrame = z.infer<typeof WsCloseFrameSchema>;

/** Response of `POST /relay/v1/environments`. */
export const GraftRelayEnvironmentRegistrationSchema = z.object({
  environmentId: z.string().min(1),
  uplinkSecret: z.string().min(16),
  httpBaseUrl: z.string().url(),
  wsBaseUrl: z.string().url(),
  uplinkUrl: z.string().url(),
});
export type GraftRelayEnvironmentRegistration = z.infer<
  typeof GraftRelayEnvironmentRegistrationSchema
>;

export function parseRelayUplinkFrame(
  raw: unknown,
): GraftRelayUplinkFrame | null {
  const parsed = GraftRelayUplinkFrameSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseRelayDownlinkFrame(
  raw: unknown,
): GraftRelayDownlinkFrame | null {
  const parsed = GraftRelayDownlinkFrameSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** `https://relay.example/e/{environmentId}` — the phone's HTTP base. */
export function buildRelayEnvironmentHttpBaseUrl(
  relayBaseUrl: string,
  environmentId: string,
): string {
  const base = new URL(relayBaseUrl);
  base.pathname = `${GRAFT_RELAY_ENVIRONMENT_PREFIX}/${encodeURIComponent(environmentId)}`;
  base.search = "";
  base.hash = "";
  return base.toString().replace(/\/$/, "");
}
