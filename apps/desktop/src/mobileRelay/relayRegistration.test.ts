import { describe, expect, it, vi } from "vitest";
import {
  RelaySignedOutError,
  clearStoredRelayCredential,
  ensureRelayCredential,
  readStoredRelayCredential,
  registerRelayEnvironment,
  type RelayRegistrationDependencies,
} from "./relayRegistration.js";
import type { RemoteSessionSecretStore } from "./remoteSessionSecretStore.js";

const REGISTRATION = {
  environmentId: "env-9f2c",
  uplinkSecret: "0123456789abcdef0123456789abcdef",
  httpBaseUrl: "https://relay.graftapp.io/e/env-9f2c",
  wsBaseUrl: "wss://relay.graftapp.io/e/env-9f2c",
  uplinkUrl: "wss://relay.graftapp.io/relay/v1/uplink",
};

function inMemorySecretStore(
  initial: Record<string, string> = {},
): RemoteSessionSecretStore & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: (key) => values.get(key) ?? null,
    set: (key, secret) => {
      values.set(key, secret);
    },
    delete: (key) => {
      values.delete(key);
    },
  };
}

function setup(
  overrides: Partial<RelayRegistrationDependencies> = {},
  body: unknown = REGISTRATION,
  status = 200,
) {
  const secretStore = inMemorySecretStore();
  const fetchImpl = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  const dependencies: RelayRegistrationDependencies = {
    controlPlaneBaseUrl: "https://api.graftapp.io/",
    getAccountToken: async () => "account-jwt",
    secretStore,
    label: "Studio Mac",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...overrides,
  };
  return { dependencies, secretStore, fetchImpl };
}

describe("relay registration", () => {
  it("registers with the account token and remembers the uplink secret", async () => {
    const { dependencies, secretStore, fetchImpl } = setup();

    const credential = await registerRelayEnvironment(dependencies);

    expect(credential).toEqual(REGISTRATION);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    if (!init) throw new Error("registration never called the control plane");
    expect(url).toBe("https://api.graftapp.io/relay/v1/environments");
    expect(init.headers).toMatchObject({ authorization: "Bearer account-jwt" });
    expect(JSON.parse(String(init.body))).toEqual({ label: "Studio Mac" });

    // Surviving a relaunch is what keeps paired phones pointed at the same URL.
    expect(readStoredRelayCredential(secretStore)).toEqual(REGISTRATION);
  });

  it("reuses a stored credential instead of registering again", async () => {
    const { dependencies, fetchImpl } = setup();
    await registerRelayEnvironment(dependencies);
    fetchImpl.mockClear();

    expect(await ensureRelayCredential(dependencies)).toEqual(REGISTRATION);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("drops a leftover uplink secret when the owner is signed out", async () => {
    const { dependencies, secretStore, fetchImpl } = setup({
      getAccountToken: async () => null,
    });
    secretStore.set("relay-uplink", JSON.stringify(REGISTRATION));

    await expect(ensureRelayCredential(dependencies)).rejects.toBeInstanceOf(
      RelaySignedOutError,
    );
    expect(readStoredRelayCredential(secretStore)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rekeys an existing environment so paired phones keep working", async () => {
    const { dependencies, fetchImpl } = setup();

    await registerRelayEnvironment(dependencies, {
      environmentId: REGISTRATION.environmentId,
    });

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    if (!init) throw new Error("registration never called the control plane");
    expect(JSON.parse(String(init.body))).toEqual({
      label: "Studio Mac",
      environmentId: REGISTRATION.environmentId,
    });
  });

  it("asks the owner to sign in rather than dialing out unauthenticated", async () => {
    const { dependencies, fetchImpl } = setup({
      getAccountToken: async () => null,
    });

    await expect(ensureRelayCredential(dependencies)).rejects.toBeInstanceOf(
      RelaySignedOutError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a rejected token as signed out", async () => {
    const { dependencies } = setup({}, { error: "unauthorized" }, 401);

    await expect(registerRelayEnvironment(dependencies)).rejects.toBeInstanceOf(
      RelaySignedOutError,
    );
  });

  it("refuses a response that is not a usable credential", async () => {
    const { dependencies, secretStore } = setup({}, { environmentId: "env-1" });

    await expect(registerRelayEnvironment(dependencies)).rejects.toThrow(
      /unusable response/,
    );
    expect(readStoredRelayCredential(secretStore)).toBeNull();
  });

  it("ignores a stored credential the relay could no longer honour", () => {
    const secretStore = inMemorySecretStore({
      "relay-uplink": "{ not json",
    });

    expect(readStoredRelayCredential(secretStore)).toBeNull();

    clearStoredRelayCredential(secretStore);
    expect(secretStore.values.size).toBe(0);
  });
});
