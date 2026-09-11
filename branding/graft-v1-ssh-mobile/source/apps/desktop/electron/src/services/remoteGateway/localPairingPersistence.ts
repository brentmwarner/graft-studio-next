import {
  LocalStore,
  type RemoteDeviceRow,
  type RemoteSessionRow,
} from "../../db/db.js";
import type {
  PairingDeviceRecord,
  PairingPersistence,
  PairingSessionRecord,
} from "./pairingService.js";

export function createLocalPairingPersistence(
  store: LocalStore,
  options?: { closeStore?: boolean },
): PairingPersistence {
  return {
    createPairing(input) {
      store.createRemotePairing({
        device: {
          id: input.device.deviceId,
          label: input.device.label,
          platform: input.device.platform,
          appVersion: input.device.appVersion,
          environmentId: input.device.environmentId,
          clientDeviceId: input.device.clientDeviceId,
          createdAt: input.device.createdAt,
          lastSeenAt: input.device.lastSeenAt,
          revokedAt: input.device.revokedAt,
        },
        session: {
          id: input.session.sessionId,
          deviceId: input.session.deviceId,
          bearerDigest: input.session.bearerDigest,
          httpBaseUrl: input.session.httpBaseUrl,
          wsBaseUrl: input.session.wsBaseUrl,
          endpointKind: input.session.endpointKind,
          protocolVersion: input.session.protocolVersion,
          capabilities: input.session.capabilities,
          secretAccountKey: input.session.secretAccountKey,
          createdAt: input.session.createdAt,
          lastSeenAt: input.session.lastSeenAt,
          expiresAt: input.session.expiresAt,
          revokedAt: input.session.revokedAt,
        },
      });
    },
    getDevice(deviceId) {
      return mapDevice(store.getRemoteDevice(deviceId));
    },
    findDeviceByClientId(environmentId, clientDeviceId) {
      return mapDevice(
        store.findRemoteDeviceByClientId(environmentId, clientDeviceId),
      );
    },
    listDevices() {
      return store.listRemoteDevices().map((device) => mapDevice(device)!);
    },
    getSessionById(sessionId) {
      return mapSession(store.getRemoteSessionById(sessionId));
    },
    getSessionByBearerDigest(digest) {
      return mapSession(store.getRemoteSessionByBearerDigest(digest));
    },
    listActiveSessions(now) {
      return store
        .listActiveRemoteSessions(now)
        .map((session) => mapSession(session)!);
    },
    listSessionsByDevice(deviceId) {
      return store
        .listRemoteSessionsByDevice(deviceId)
        .map((session) => mapSession(session)!);
    },
    touchSession(sessionId, at) {
      return store.touchRemoteSession(sessionId, at);
    },
    revokeSession(sessionId, at) {
      return store.revokeRemoteSession(sessionId, at);
    },
    revokeDevice(deviceId, at) {
      return store.revokeRemoteDevice(deviceId, at).sessionsRevoked;
    },
    upsertPushRegistration(input) {
      return store.upsertRemotePushRegistration(input);
    },
    getPushRegistration(deviceId) {
      return store.getRemotePushRegistration(deviceId);
    },
    deletePushRegistration(deviceId) {
      return store.deleteRemotePushRegistration(deviceId);
    },
    // Production shares one LocalStore with IpcController — never close it
    // from pairing teardown. Tests may opt into closeStore for cleanup.
    ...(options?.closeStore
      ? {
          close() {
            store.close();
          },
        }
      : {}),
  };
}

function mapDevice(row: RemoteDeviceRow | null): PairingDeviceRecord | null {
  if (!row) return null;
  return {
    deviceId: row.id,
    label: row.label,
    platform: row.platform,
    appVersion: row.appVersion,
    environmentId: row.environmentId,
    clientDeviceId: row.clientDeviceId,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
  };
}

function mapSession(row: RemoteSessionRow | null): PairingSessionRecord | null {
  if (!row) return null;
  return {
    sessionId: row.id,
    deviceId: row.deviceId,
    bearerDigest: row.bearerDigest,
    httpBaseUrl: row.httpBaseUrl,
    wsBaseUrl: row.wsBaseUrl,
    endpointKind: row.endpointKind,
    protocolVersion: row.protocolVersion,
    capabilities: [...row.capabilities],
    secretAccountKey: row.secretAccountKey,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}
