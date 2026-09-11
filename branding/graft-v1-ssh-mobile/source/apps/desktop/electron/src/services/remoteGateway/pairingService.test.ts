import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStore } from "../../db/db.js";
import { createLocalPairingPersistence } from "./localPairingPersistence.js";
import {
  createPairingService,
  type PairingPersistence,
} from "./pairingService.js";
import type { RemoteSessionSecretStore } from "./remoteSessionSecretStore.js";

const dbPaths: string[] = [];

afterEach(() => {
  for (const dbPath of dbPaths.splice(0)) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
  }
});

describe("durable pairing service", () => {
  it("binds the advertised endpoint to the one-time token and rejects wildcard URLs", () => {
    const service = createPairingService({
      ...gatewayConfig(),
      host: "0.0.0.0",
      networkAccessEnabled: true,
    });

    expect(() => service.issuePairingCredential()).toThrow(
      "Pairing endpoints must use a concrete reachable address",
    );

    const issued = service.issuePairingCredential(undefined, {
      kind: "tailnet",
      httpBaseUrl: "http://100.80.70.60:4783",
      wsBaseUrl: "ws://100.80.70.60:4783",
    });
    const exchanged = service.exchangeToken({
      token: issued.token,
      protocolVersion: 1,
      client: { platform: "ios", appVersion: "1.0" },
    });

    expect(exchanged).toEqual(
      expect.objectContaining({
        ok: true,
        session: expect.objectContaining({
          httpBaseUrl: "http://100.80.70.60:4783",
          wsBaseUrl: "ws://100.80.70.60:4783",
        }),
      }),
    );
  });

  it("authenticates after restart and keeps revocation durable", () => {
    const dbPath = temporaryDatabasePath();
    const secrets = memorySecretStore();
    const first = durableService(dbPath, secrets);
    const issued = first.issuePairingCredential();
    const exchanged = first.exchangeToken({
      token: issued.token,
      protocolVersion: 1,
      client: {
        platform: "ios",
        appVersion: "1.2.3",
        deviceLabel: "Brent's iPhone",
      },
    });
    expect(exchanged.ok).toBe(true);
    if (!exchanged.ok) return;
    const session = exchanged.session;
    expect(first.getSessionByBearer(session.bearerToken)?.sessionId).toBe(
      session.sessionId,
    );
    first.close();

    const reopened = durableService(dbPath, secrets);
    expect(reopened.getSessionByBearer(session.bearerToken)?.sessionId).toBe(
      session.sessionId,
    );
    expect(reopened.listDevices()).toEqual([
      expect.objectContaining({
        deviceId: session.deviceId,
        sessionId: session.sessionId,
        label: "Brent's iPhone",
        platform: "ios",
        appVersion: "1.2.3",
      }),
    ]);
    expect(reopened.revokeDevice(session.deviceId)).toBe(1);
    reopened.close();

    const afterRevoke = durableService(dbPath, secrets);
    expect(afterRevoke.getSessionByBearer(session.bearerToken)).toBeNull();
    expect(afterRevoke.listDevices()).toEqual([]);
    afterRevoke.close();
  });

  it("re-pairing with the same client identity replaces the device's prior session", () => {
    const dbPath = temporaryDatabasePath();
    const secrets = memorySecretStore();
    const service = durableService(dbPath, secrets);
    const client = {
      platform: "ios" as const,
      appVersion: "1.0",
      deviceLabel: "Brent's iPhone",
      deviceId: "11111111-2222-3333-4444-555555555555",
    };

    const first = service.exchangeToken({
      token: service.issuePairingCredential().token,
      protocolVersion: 1,
      client,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = service.exchangeToken({
      token: service.issuePairingCredential().token,
      protocolVersion: 1,
      client: { ...client, appVersion: "1.1" },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.session.deviceId).toBe(first.session.deviceId);
    expect(service.listDevices()).toEqual([
      expect.objectContaining({
        deviceId: first.session.deviceId,
        sessionId: second.session.sessionId,
        appVersion: "1.1",
      }),
    ]);
    expect(service.getSessionByBearer(first.session.bearerToken)).toBeNull();
    expect(
      service.getSessionByBearer(second.session.bearerToken)?.sessionId,
    ).toBe(second.session.sessionId);
    expect(secrets.get(`remote-session:${first.session.sessionId}`)).toBeNull();
    service.close();
  });

  it("pairs without a client identity as a distinct device each time", () => {
    const dbPath = temporaryDatabasePath();
    const service = durableService(dbPath, memorySecretStore());
    const client = { platform: "ios" as const, appVersion: "1.0" };

    const first = service.exchangeToken({
      token: service.issuePairingCredential().token,
      protocolVersion: 1,
      client,
    });
    const second = service.exchangeToken({
      token: service.issuePairingCredential().token,
      protocolVersion: 1,
      client,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.session.deviceId).not.toBe(first.session.deviceId);
    expect(service.listDevices()).toHaveLength(2);
    service.close();
  });

  it("fails authentication when the secure-store value is missing", () => {
    const dbPath = temporaryDatabasePath();
    const secrets = memorySecretStore();
    const service = durableService(dbPath, secrets);
    const issued = service.issuePairingCredential();
    const exchanged = service.exchangeToken({
      token: issued.token,
      protocolVersion: 1,
      client: { platform: "ios", appVersion: "1.0" },
    });
    expect(exchanged.ok).toBe(true);
    if (!exchanged.ok) return;

    secrets.clear();
    expect(
      service.getSessionByBearer(exchanged.session.bearerToken),
    ).toBeNull();
    service.close();
  });

  it("compensates the secure write when metadata creation fails", () => {
    const secrets = memorySecretStore();
    const persistence = failingPersistence();
    const service = createPairingService(gatewayConfig(), {
      persistence,
      secretStore: secrets,
    });
    const issued = service.issuePairingCredential();

    expect(() =>
      service.exchangeToken({
        token: issued.token,
        protocolVersion: 1,
        client: { platform: "ios", appVersion: "1.0" },
      }),
    ).toThrow("metadata write failed");
    expect(secrets.size()).toBe(0);
  });

  it("does not mutate a push secret when the previous value cannot be read", () => {
    const dbPath = temporaryDatabasePath();
    const storedSecrets = memorySecretStore();
    let pushWriteAttempted = false;
    const service = createPairingService(gatewayConfig(), {
      persistence: createLocalPairingPersistence(new LocalStore(dbPath), {
        closeStore: true,
      }),
      secretStore: {
        get(accountKey) {
          if (accountKey.startsWith("remote-push:")) {
            throw new Error("secure store unavailable");
          }
          return storedSecrets.get(accountKey);
        },
        set(accountKey, secret) {
          if (accountKey.startsWith("remote-push:")) {
            pushWriteAttempted = true;
          }
          storedSecrets.set(accountKey, secret);
        },
        delete(accountKey) {
          storedSecrets.delete(accountKey);
        },
      },
    });
    const issued = service.issuePairingCredential();
    const exchanged = service.exchangeToken({
      token: issued.token,
      protocolVersion: 1,
      client: { platform: "ios", appVersion: "1.0" },
    });
    expect(exchanged.ok).toBe(true);
    if (!exchanged.ok) return;

    expect(() =>
      service.registerPushRegistration(exchanged.session, {
        apnsToken: "0011223344556677",
        apnsEnvironment: "sandbox",
        bundleId: "studio.graft.mobile",
      }),
    ).toThrow("secure store unavailable");
    expect(pushWriteAttempted).toBe(false);
    service.close();
  });
});

function durableService(dbPath: string, secretStore: RemoteSessionSecretStore) {
  return createPairingService(gatewayConfig(), {
    persistence: createLocalPairingPersistence(new LocalStore(dbPath), {
      closeStore: true,
    }),
    secretStore,
  });
}

function gatewayConfig() {
  return {
    host: "127.0.0.1",
    port: 4783,
    environmentId: "env-local",
    environmentLabel: "Studio Mac",
    networkAccessEnabled: false,
  };
}

function temporaryDatabasePath(): string {
  const path = join(tmpdir(), `graft-pairing-${randomUUID()}.db`);
  dbPaths.push(path);
  return path;
}

function memorySecretStore(): RemoteSessionSecretStore & {
  clear: () => void;
  size: () => number;
} {
  const values = new Map<string, string>();
  return {
    get(accountKey) {
      return values.get(accountKey) ?? null;
    },
    set(accountKey, secret) {
      values.set(accountKey, secret);
    },
    delete(accountKey) {
      values.delete(accountKey);
    },
    clear() {
      values.clear();
    },
    size() {
      return values.size;
    },
  };
}

function failingPersistence(): PairingPersistence {
  return {
    createPairing() {
      throw new Error("metadata write failed");
    },
    getDevice: () => null,
    findDeviceByClientId: () => null,
    listDevices: () => [],
    getSessionById: () => null,
    getSessionByBearerDigest: () => null,
    listActiveSessions: () => [],
    listSessionsByDevice: () => [],
    touchSession: () => false,
    revokeSession: () => false,
    revokeDevice: () => 0,
    upsertPushRegistration: (input) => input,
    getPushRegistration: () => null,
    deletePushRegistration: () => false,
  };
}
