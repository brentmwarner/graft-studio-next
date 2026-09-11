import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GraftPairExchangeResponseSchema,
  GraftPushRegistrationResponseSchema,
  GraftPushUnregistrationResponseSchema,
} from "@graft/shared";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStore } from "../../db/db.js";
import {
  createRemoteGateway,
  type RemoteGateway,
} from "./createRemoteGateway.js";
import { createLocalPairingPersistence } from "./localPairingPersistence.js";
import type { RemoteSessionSecretStore } from "./remoteSessionSecretStore.js";
import { createStubRemoteGatewayHandlers } from "./types.js";

const handlers = createStubRemoteGatewayHandlers({
  startTurn: async () => ({ runId: "run-1" }),
});

describe("push registration routes", () => {
  let gateway: RemoteGateway | undefined;
  let store: LocalStore | undefined;
  let dbPath: string | undefined;

  afterEach(async () => {
    if (gateway) await gateway.stop();
    gateway = undefined;
    store?.close();
    store = undefined;
    if (dbPath) {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
    }
    dbPath = undefined;
  });

  it("returns 404 and performs no writes while the feature is disabled", async () => {
    const setup = await startGateway(false);
    gateway = setup.gateway;
    store = setup.store;
    dbPath = setup.dbPath;
    const session = await pair(setup);
    const apnsToken = "ab".repeat(20);

    const response = await register(setup, session.bearerToken, apnsToken);

    expect(response.status).toBe(404);
    expect(store.getRemotePushRegistration(session.deviceId)).toBeNull();
    expect(setup.secrets.get(`remote-push:${session.deviceId}`)).toBeNull();
  });

  it("derives device identity from bearer auth and securely upserts variable-length tokens", async () => {
    const setup = await startGateway(true);
    gateway = setup.gateway;
    store = setup.store;
    dbPath = setup.dbPath;
    const session = await pair(setup);

    const unauthorized = await register(setup, "invalid-bearer", "aabb");
    expect(unauthorized.status).toBe(401);

    const malformedUnauthorized = await fetch(pushUrl(setup), {
      method: "PUT",
      headers: {
        authorization: "Bearer invalid-bearer",
        "content-type": "application/json",
      },
      body: "{",
    });
    expect(malformedUnauthorized.status).toBe(401);

    const oversized = await register(
      setup,
      session.bearerToken,
      "aa".repeat(40_000),
    );
    expect(oversized.status).toBe(400);

    const clientSelectedDevice = await fetch(pushUrl(setup), {
      method: "PUT",
      headers: {
        authorization: `Bearer ${session.bearerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        apnsToken: "aabb",
        apnsEnvironment: "sandbox",
        bundleId: "studio.graft.mobile",
        deviceId: "attacker-device",
      }),
    });
    expect(clientSelectedDevice.status).toBe(400);

    for (const apnsToken of ["ab", "0123456789abcdef".repeat(16)]) {
      const response = await register(setup, session.bearerToken, apnsToken);
      expect(response.ok).toBe(true);
      const serialized = await response.text();
      const body = GraftPushRegistrationResponseSchema.parse(
        JSON.parse(serialized),
      );
      expect(body.registration.deviceId).toBe(session.deviceId);
      // The deviceId is random hex, so a 2-char hex token collides with it by
      // chance ~9% of the time. Drop it from the haystack — it is asserted
      // exactly above and is not secret — so the leak check stays sharp for
      // short tokens instead of failing at random.
      const withoutDeviceId = serialized.split(session.deviceId).join("");
      expect(withoutDeviceId).not.toContain(apnsToken);
      expect(setup.secrets.get(`remote-push:${session.deviceId}`)).toBe(
        apnsToken,
      );
    }

    expect(store.getRemotePushRegistration(session.deviceId)).toEqual(
      expect.objectContaining({
        deviceId: session.deviceId,
        bundleId: "studio.graft.mobile",
        apnsEnvironment: "sandbox",
        secretAccountKey: `remote-push:${session.deviceId}`,
      }),
    );
  });

  it("unregisters idempotently and revocation removes registration secrets", async () => {
    const setup = await startGateway(true);
    gateway = setup.gateway;
    store = setup.store;
    dbPath = setup.dbPath;
    const session = await pair(setup);
    await register(setup, session.bearerToken, "aabbccdd");

    const firstDelete = await unregister(setup, session.bearerToken);
    expect(
      GraftPushUnregistrationResponseSchema.parse(await firstDelete.json()),
    ).toEqual({ ok: true, removed: true });
    const secondDelete = await unregister(setup, session.bearerToken);
    expect(
      GraftPushUnregistrationResponseSchema.parse(await secondDelete.json()),
    ).toEqual({ ok: true, removed: false });
    expect(setup.secrets.get(`remote-push:${session.deviceId}`)).toBeNull();

    await register(setup, session.bearerToken, "001122334455");
    setup.gateway.revokeDevice(session.deviceId);
    expect(store.getRemotePushRegistration(session.deviceId)).toBeNull();
    expect(setup.secrets.get(`remote-push:${session.deviceId}`)).toBeNull();
    expect(
      (await register(setup, session.bearerToken, "aabbccdd")).status,
    ).toBe(401);
  });

  async function startGateway(pushRegistrationEnabled: boolean) {
    const { host, port } = await availableAddress();
    const path = join(tmpdir(), `graft-push-routes-${randomUUID()}.db`);
    const localStore = new LocalStore(path);
    const secrets = memorySecretStore();
    const remoteGateway = createRemoteGateway(
      {
        host,
        port,
        environmentId: "env-push-test",
        environmentLabel: "Push Test Mac",
        networkAccessEnabled: false,
        pushRegistrationEnabled,
      },
      handlers,
      {
        pairingDependencies: {
          persistence: createLocalPairingPersistence(localStore),
          secretStore: secrets,
        },
      },
    );
    await remoteGateway.start();
    return {
      dbPath: path,
      gateway: remoteGateway,
      host,
      port,
      secrets,
      store: localStore,
    };
  }
});

async function availableAddress(): Promise<{ host: string; port: number }> {
  const host = "127.0.0.1";
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, host, resolve);
  });
  const address = probe.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to allocate a test port");
  }
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
  return { host, port: address.port };
}

async function pair(setup: Awaited<ReturnType<GatewaySetup>>) {
  const issued = setup.gateway.issuePairingCredential();
  const response = await fetch(`http://${setup.host}:${setup.port}/v1/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: issued.token,
      protocolVersion: 1,
      client: { platform: "ios", appVersion: "1.0" },
    }),
  });
  return GraftPairExchangeResponseSchema.parse(await response.json()).session;
}

type GatewaySetup = () => Promise<{
  gateway: RemoteGateway;
  host: string;
  port: number;
  secrets: RemoteSessionSecretStore;
  store: LocalStore;
  dbPath: string;
}>;

function pushUrl(setup: Awaited<ReturnType<GatewaySetup>>): string {
  return `http://${setup.host}:${setup.port}/v1/push-registration`;
}

function register(
  setup: Awaited<ReturnType<GatewaySetup>>,
  bearerToken: string,
  apnsToken: string,
): Promise<Response> {
  return fetch(pushUrl(setup), {
    method: "PUT",
    headers: {
      authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      apnsToken,
      apnsEnvironment: "sandbox",
      bundleId: "studio.graft.mobile",
    }),
  });
}

function unregister(
  setup: Awaited<ReturnType<GatewaySetup>>,
  bearerToken: string,
): Promise<Response> {
  return fetch(pushUrl(setup), {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
}

function memorySecretStore(): RemoteSessionSecretStore {
  const values = new Map<string, string>();
  return {
    get: (accountKey) => values.get(accountKey) ?? null,
    set: (accountKey, secret) => {
      values.set(accountKey, secret);
    },
    delete: (accountKey) => {
      values.delete(accountKey);
    },
  };
}
