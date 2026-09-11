import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  DEFAULT_MOBILE_CAPABILITIES,
  GRAFT_MOBILE_PROTOCOL_VERSION,
  buildGraftPairingUrl,
  toWebSocketBaseUrl,
  type GraftMobileCapability,
  type GraftPairExchangeRequest,
  type GraftPushRegistrationMetadata,
  type GraftPushRegistrationRequest,
  type GraftRemoteEndpointKind,
  type GraftSessionCredential,
} from "@graft/shared";
import type { RemoteSessionSecretStore } from "./remoteSessionSecretStore.js";
import type {
  IssuedPairingCredential,
  RemoteGatewayConfig,
  RemoteGatewayEndpoint,
} from "./types.js";

type PairingTokenState = {
  expiresAt: number;
  consumed: boolean;
  endpoint: RemoteGatewayEndpoint;
};

export type PairingDeviceRecord = {
  deviceId: string;
  label: string;
  platform: GraftPairExchangeRequest["client"]["platform"];
  appVersion: string;
  environmentId: string;
  clientDeviceId: string | null;
  createdAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
};

export type PairingSessionRecord = {
  sessionId: string;
  deviceId: string;
  bearerDigest: string;
  httpBaseUrl: string;
  wsBaseUrl: string;
  endpointKind: GraftRemoteEndpointKind;
  protocolVersion: number;
  capabilities: GraftMobileCapability[];
  secretAccountKey: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
};

export type PairingPushRegistrationRecord = GraftPushRegistrationMetadata & {
  secretAccountKey: string;
};

export type PairingPersistence = {
  createPairing: (input: {
    device: PairingDeviceRecord;
    session: PairingSessionRecord;
  }) => void;
  getDevice: (deviceId: string) => PairingDeviceRecord | null;
  findDeviceByClientId: (
    environmentId: string,
    clientDeviceId: string,
  ) => PairingDeviceRecord | null;
  listDevices: () => PairingDeviceRecord[];
  getSessionById: (sessionId: string) => PairingSessionRecord | null;
  getSessionByBearerDigest: (
    bearerDigest: string,
  ) => PairingSessionRecord | null;
  listActiveSessions: (now: number) => PairingSessionRecord[];
  listSessionsByDevice: (deviceId: string) => PairingSessionRecord[];
  touchSession: (sessionId: string, at: number) => boolean;
  revokeSession: (sessionId: string, at: number) => boolean;
  revokeDevice: (deviceId: string, at: number) => number;
  upsertPushRegistration: (
    input: PairingPushRegistrationRecord,
  ) => PairingPushRegistrationRecord;
  getPushRegistration: (
    deviceId: string,
  ) => PairingPushRegistrationRecord | null;
  deletePushRegistration: (deviceId: string) => boolean;
  close?: () => void;
};

export type PairingServiceDependencies = {
  persistence: PairingPersistence;
  secretStore: RemoteSessionSecretStore;
  now?: () => number;
};

export type PairedDevice = {
  deviceId: string;
  sessionId: string;
  label: string;
  platform: PairingDeviceRecord["platform"];
  appVersion: string;
  environmentId: string;
  lastSeenAt: number;
};

export type PairingService = {
  issuePairingCredential: (
    ttlMs?: number,
    endpoint?: RemoteGatewayEndpoint,
  ) => IssuedPairingCredential;
  exchangeToken: (request: GraftPairExchangeRequest) =>
    | { ok: true; session: GraftSessionCredential }
    | {
        ok: false;
        status: number;
        code:
          | "pairing_token_invalid"
          | "pairing_token_expired"
          | "pairing_token_replayed";
        message: string;
      };
  getSessionByBearer: (bearerToken: string) => GraftSessionCredential | null;
  getSessionById: (sessionId: string) => GraftSessionCredential | null;
  revokeSession: (sessionId: string) => boolean;
  revokeDevice: (deviceId: string) => number;
  registerPushRegistration: (
    session: GraftSessionCredential,
    request: GraftPushRegistrationRequest,
  ) => GraftPushRegistrationMetadata;
  unregisterPushRegistration: (session: GraftSessionCredential) => boolean;
  listSessions: () => GraftSessionCredential[];
  listDevices: () => PairedDevice[];
  close: () => void;
};

export function createPairingService(
  config: RemoteGatewayConfig,
  dependencies?: PairingServiceDependencies,
): PairingService {
  const pairingTokens = new Map<string, PairingTokenState>();
  const resolvedDependencies = dependencies ?? createInMemoryDependencies();
  const persistence = resolvedDependencies.persistence;
  const secretStore = resolvedDependencies.secretStore;
  const now = resolvedDependencies.now ?? Date.now;

  function sessionIsActive(record: PairingSessionRecord): boolean {
    if (record.revokedAt !== null) return false;
    if (record.expiresAt !== null && record.expiresAt <= now()) return false;
    return persistence.getDevice(record.deviceId)?.revokedAt === null;
  }

  function readBearer(record: PairingSessionRecord): string | null {
    try {
      return secretStore.get(record.secretAccountKey);
    } catch {
      return null;
    }
  }

  function credential(
    record: PairingSessionRecord,
    bearerToken: string,
  ): GraftSessionCredential {
    return {
      sessionId: record.sessionId,
      deviceId: record.deviceId,
      bearerToken,
      environmentId: config.environmentId,
      environmentLabel: config.environmentLabel,
      httpBaseUrl: record.httpBaseUrl,
      wsBaseUrl: record.wsBaseUrl,
      protocolVersion: GRAFT_MOBILE_PROTOCOL_VERSION,
      capabilities: [...record.capabilities],
      expiresAt: record.expiresAt,
      endpointKind: record.endpointKind,
    };
  }

  function authenticatedSession(
    record: PairingSessionRecord | null,
    presentedBearer?: string,
    touch = true,
  ): GraftSessionCredential | null {
    if (!record || !sessionIsActive(record)) return null;
    const storedBearer = readBearer(record);
    if (!storedBearer) return null;
    if (
      presentedBearer !== undefined &&
      !constantTimeEqual(storedBearer, presentedBearer)
    ) {
      return null;
    }
    if (touch) {
      persistence.touchSession(record.sessionId, now());
    }
    return credential(record, storedBearer);
  }

  return {
    issuePairingCredential(
      ttlMs = 15 * 60 * 1000,
      endpoint = defaultEndpoint(config),
    ) {
      assertAdvertisableEndpoint(endpoint);
      const issuedAt = now();
      for (const [existingToken, state] of pairingTokens) {
        if (state.expiresAt <= issuedAt) pairingTokens.delete(existingToken);
      }
      const token = randomBytes(18).toString("base64url");
      const expiresAt = issuedAt + ttlMs;
      pairingTokens.set(token, { expiresAt, consumed: false, endpoint });
      const pairingUrl = buildGraftPairingUrl({
        v: GRAFT_MOBILE_PROTOCOL_VERSION,
        host: endpoint.httpBaseUrl,
        token,
        label: config.environmentLabel,
        endpointKind: endpoint.kind,
      });
      return {
        token,
        expiresAt,
        pairingUrl,
        endpoint: { ...endpoint },
      };
    },

    exchangeToken(request) {
      const tokenState = pairingTokens.get(request.token);
      if (!tokenState) {
        return {
          ok: false,
          status: 401,
          code: "pairing_token_invalid",
          message: "invalid_or_expired_token",
        };
      }
      if (tokenState.expiresAt <= now()) {
        return {
          ok: false,
          status: 401,
          code: "pairing_token_expired",
          message: "invalid_or_expired_token",
        };
      }
      if (tokenState.consumed) {
        return {
          ok: false,
          status: 401,
          code: "pairing_token_replayed",
          message: "pairing_token_already_used",
        };
      }

      tokenState.consumed = true;
      const createdAt = now();
      const endpoint = tokenState.endpoint;
      const sessionId = randomBytes(12).toString("hex");
      const bearerToken = randomBytes(24).toString("hex");
      const secretAccountKey = `remote-session:${sessionId}`;

      // A returning physical device (matched by its client-generated identity)
      // keeps its device row: the fresh session replaces the old ones instead
      // of accumulating a duplicate registration per pairing exchange.
      const clientDeviceId = request.client.deviceId ?? null;
      const existingDevice = clientDeviceId
        ? persistence.findDeviceByClientId(config.environmentId, clientDeviceId)
        : null;
      const deviceId = existingDevice?.deviceId ?? randomBytes(12).toString("hex");
      if (existingDevice) {
        for (const staleSession of persistence.listSessionsByDevice(deviceId)) {
          if (staleSession.revokedAt !== null) continue;
          persistence.revokeSession(staleSession.sessionId, createdAt);
          deleteSecretBestEffort(secretStore, staleSession.secretAccountKey);
        }
      }
      const sessionRecord: PairingSessionRecord = {
        sessionId,
        deviceId,
        bearerDigest: bearerDigest(bearerToken),
        httpBaseUrl: endpoint.httpBaseUrl,
        wsBaseUrl: endpoint.wsBaseUrl,
        endpointKind: endpoint.kind,
        protocolVersion: GRAFT_MOBILE_PROTOCOL_VERSION,
        capabilities: [...DEFAULT_MOBILE_CAPABILITIES],
        secretAccountKey,
        createdAt,
        lastSeenAt: createdAt,
        expiresAt: null,
        revokedAt: null,
      };
      const deviceRecord: PairingDeviceRecord = {
        deviceId,
        label: request.client.deviceLabel ?? request.client.platform,
        platform: request.client.platform,
        appVersion: request.client.appVersion,
        environmentId: config.environmentId,
        clientDeviceId,
        createdAt: existingDevice?.createdAt ?? createdAt,
        lastSeenAt: createdAt,
        revokedAt: null,
      };

      secretStore.set(secretAccountKey, bearerToken);
      try {
        persistence.createPairing({
          device: deviceRecord,
          session: sessionRecord,
        });
      } catch (error) {
        try {
          secretStore.delete(secretAccountKey);
        } catch {
          // The metadata write failed, so an undeleted secret is an orphan and
          // cannot authenticate. Preserve the database failure.
        }
        throw error;
      }

      return {
        ok: true,
        session: credential(sessionRecord, bearerToken),
      };
    },

    getSessionByBearer(bearerToken) {
      return authenticatedSession(
        persistence.getSessionByBearerDigest(bearerDigest(bearerToken)),
        bearerToken,
      );
    },

    getSessionById(sessionId) {
      return authenticatedSession(persistence.getSessionById(sessionId));
    },

    revokeSession(sessionId) {
      const record = persistence.getSessionById(sessionId);
      if (!record) return false;
      const revoked = persistence.revokeSession(sessionId, now());
      if (revoked) {
        deleteSecretBestEffort(secretStore, record.secretAccountKey);
      }
      return revoked;
    },

    revokeDevice(deviceId) {
      const sessions = persistence.listSessionsByDevice(deviceId);
      const pushRegistration = persistence.getPushRegistration(deviceId);
      const count = persistence.revokeDevice(deviceId, now());
      for (const session of sessions) {
        deleteSecretBestEffort(secretStore, session.secretAccountKey);
      }
      if (pushRegistration) {
        deleteSecretBestEffort(secretStore, pushRegistration.secretAccountKey);
      }
      return count;
    },

    registerPushRegistration(session, request) {
      const createdAt = now();
      const accountKey = `remote-push:${session.deviceId}`;
      const previousRegistration = persistence.getPushRegistration(
        session.deviceId,
      );
      // Read strictly before mutating. If the secure store is unavailable, do
      // not risk overwriting a credential that cannot be restored.
      const previousSecret = secretStore.get(accountKey);
      secretStore.set(accountKey, request.apnsToken);
      try {
        const registration = persistence.upsertPushRegistration({
          deviceId: session.deviceId,
          apnsEnvironment: request.apnsEnvironment,
          bundleId: request.bundleId,
          secretAccountKey: accountKey,
          createdAt: previousRegistration?.createdAt ?? createdAt,
          updatedAt: createdAt,
        });
        return {
          deviceId: registration.deviceId,
          apnsEnvironment: registration.apnsEnvironment,
          bundleId: registration.bundleId,
          createdAt: registration.createdAt,
          updatedAt: registration.updatedAt,
        };
      } catch (error) {
        restoreSecretBestEffort(secretStore, accountKey, previousSecret);
        throw error;
      }
    },

    unregisterPushRegistration(session) {
      const registration = persistence.getPushRegistration(session.deviceId);
      const removed = persistence.deletePushRegistration(session.deviceId);
      if (registration) {
        deleteSecretBestEffort(secretStore, registration.secretAccountKey);
      }
      return removed;
    },

    listSessions() {
      return persistence
        .listActiveSessions(now())
        .map((record) => authenticatedSession(record, undefined, false))
        .filter(
          (session): session is GraftSessionCredential => session !== null,
        );
    },

    listDevices() {
      const latestSessions = new Map<string, PairingSessionRecord>();
      for (const session of persistence.listActiveSessions(now())) {
        if (!latestSessions.has(session.deviceId)) {
          latestSessions.set(session.deviceId, session);
        }
      }
      return persistence
        .listDevices()
        .filter((device) => device.revokedAt === null)
        .flatMap((device) => {
          const session = latestSessions.get(device.deviceId);
          if (!session) return [];
          return [
            {
              deviceId: device.deviceId,
              sessionId: session.sessionId,
              label: device.label,
              platform: device.platform,
              appVersion: device.appVersion,
              environmentId: device.environmentId,
              lastSeenAt: device.lastSeenAt,
            },
          ];
        });
    },

    close() {
      persistence.close?.();
    },
  };
}

function defaultEndpoint(config: RemoteGatewayConfig): RemoteGatewayEndpoint {
  const httpBaseUrl = `http://${config.host}:${config.port}`;
  return {
    kind:
      config.host === "127.0.0.1" || config.host === "localhost"
        ? "loopback"
        : "lan",
    httpBaseUrl,
    wsBaseUrl: toWebSocketBaseUrl(httpBaseUrl),
  };
}

function assertAdvertisableEndpoint(endpoint: RemoteGatewayEndpoint): void {
  for (const value of [endpoint.httpBaseUrl, endpoint.wsBaseUrl]) {
    const hostname = new URL(value).hostname;
    if (hostname === "0.0.0.0" || hostname === "::" || hostname === "[::]") {
      throw new Error(
        "Pairing endpoints must use a concrete reachable address",
      );
    }
  }
}

function bearerDigest(bearerToken: string): string {
  return createHash("sha256").update(bearerToken, "utf8").digest("hex");
}

function constantTimeEqual(expected: string, presented: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const presentedBuffer = Buffer.from(presented, "utf8");
  if (expectedBuffer.length !== presentedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, presentedBuffer);
}

function deleteSecretBestEffort(
  secretStore: RemoteSessionSecretStore,
  accountKey: string,
): void {
  try {
    secretStore.delete(accountKey);
  } catch {
    // Revocation is authoritative in SQLite; secret cleanup can retry later.
  }
}

function restoreSecretBestEffort(
  secretStore: RemoteSessionSecretStore,
  accountKey: string,
  previousSecret: string | null,
): void {
  try {
    if (previousSecret === null) {
      secretStore.delete(accountKey);
    } else {
      secretStore.set(accountKey, previousSecret);
    }
  } catch {
    // Metadata remains unchanged, so a failed restoration can only fail closed.
  }
}

function createInMemoryDependencies(): PairingServiceDependencies {
  const devices = new Map<string, PairingDeviceRecord>();
  const sessions = new Map<string, PairingSessionRecord>();
  const pushRegistrations = new Map<string, PairingPushRegistrationRecord>();
  const secrets = new Map<string, string>();

  return {
    persistence: {
      createPairing(input) {
        if (
          [...sessions.values()].some(
            (session) => session.bearerDigest === input.session.bearerDigest,
          )
        ) {
          throw new Error("Duplicate bearer digest");
        }
        devices.set(input.device.deviceId, { ...input.device });
        sessions.set(input.session.sessionId, {
          ...input.session,
          capabilities: [...input.session.capabilities],
        });
      },
      getDevice(deviceId) {
        return devices.get(deviceId) ?? null;
      },
      findDeviceByClientId(environmentId, clientDeviceId) {
        return (
          [...devices.values()]
            .filter(
              (device) =>
                device.environmentId === environmentId &&
                device.clientDeviceId === clientDeviceId &&
                device.revokedAt === null,
            )
            .sort((left, right) => right.lastSeenAt - left.lastSeenAt)[0] ??
          null
        );
      },
      listDevices() {
        return [...devices.values()].sort(
          (left, right) => right.lastSeenAt - left.lastSeenAt,
        );
      },
      getSessionById(sessionId) {
        return sessions.get(sessionId) ?? null;
      },
      getSessionByBearerDigest(digest) {
        return (
          [...sessions.values()].find(
            (session) => session.bearerDigest === digest,
          ) ?? null
        );
      },
      listActiveSessions(at) {
        return [...sessions.values()]
          .filter((session) => {
            const device = devices.get(session.deviceId);
            return (
              session.revokedAt === null &&
              device?.revokedAt === null &&
              (session.expiresAt === null || session.expiresAt > at)
            );
          })
          .sort((left, right) => right.lastSeenAt - left.lastSeenAt);
      },
      listSessionsByDevice(deviceId) {
        return [...sessions.values()].filter(
          (session) => session.deviceId === deviceId,
        );
      },
      touchSession(sessionId, at) {
        const session = sessions.get(sessionId);
        if (!session) return false;
        session.lastSeenAt = at;
        const device = devices.get(session.deviceId);
        if (device) device.lastSeenAt = at;
        return true;
      },
      revokeSession(sessionId, at) {
        const session = sessions.get(sessionId);
        if (!session) return false;
        session.revokedAt ??= at;
        return true;
      },
      revokeDevice(deviceId, at) {
        const device = devices.get(deviceId);
        if (device) device.revokedAt ??= at;
        let count = 0;
        for (const session of sessions.values()) {
          if (session.deviceId === deviceId && session.revokedAt === null) {
            session.revokedAt = at;
            count += 1;
          }
        }
        pushRegistrations.delete(deviceId);
        return count;
      },
      upsertPushRegistration(input) {
        const registration = { ...input };
        pushRegistrations.set(input.deviceId, registration);
        return registration;
      },
      getPushRegistration(deviceId) {
        return pushRegistrations.get(deviceId) ?? null;
      },
      deletePushRegistration(deviceId) {
        return pushRegistrations.delete(deviceId);
      },
    },
    secretStore: {
      get(accountKey) {
        return secrets.get(accountKey) ?? null;
      },
      set(accountKey, secret) {
        secrets.set(accountKey, secret);
      },
      delete(accountKey) {
        secrets.delete(accountKey);
      },
    },
  };
}
