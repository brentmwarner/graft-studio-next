import { afterEach, describe, expect, it, vi } from "vitest";

import { MobileRelayController } from "./controller";
import type { RelayUplinkOptions, RelayUplinkStatus } from "./relayUplink";

const credential = {
  environmentId: "env-test", uplinkSecret: "test-uplink-secret-12345678",
  httpBaseUrl: "https://relay.test/e/env-test", wsBaseUrl: "wss://relay.test/e/env-test",
  uplinkUrl: "wss://relay.test/relay/v1/uplink",
};
const controllers: MobileRelayController[] = [];
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.dispose()));
});

function setup(signedIn = true) {
  const secrets = new Map<string, string>(signedIn ? [["graft-account-token", "account-token"]] : []);
  const gateway = { enabled: true, port: 49278 };
  const requestBackend = vi.fn(async (path: string, _body?: unknown) =>
    path.endsWith("/status") ? { ...gateway } : { ok: true },
  );
  const fetchImpl = vi.fn(async () => Response.json(credential));
  const uplinks: Array<{ options: RelayUplinkOptions; stop: ReturnType<typeof vi.fn> }> = [];
  const uplinkFactory = vi.fn((options: RelayUplinkOptions) => {
    let status: RelayUplinkStatus = {
      state: "connecting", environmentId: null, httpBaseUrl: null, wsBaseUrl: null,
      lastError: null, rejected: false,
    };
    const stop = vi.fn();
    uplinks.push({ options, stop });
    return {
      start() {
        status = { ...status, ...credential, state: "connected" };
        options.onStatusChange?.(status);
      },
      stop,
      getStatus: () => status,
    };
  });
  const controller = new MobileRelayController({
    controlPlaneBaseUrl: "https://relay.test", label: "Graft Dev",
    requestBackend, fetchImpl, uplinkFactory, openExternal: async () => {},
    secretStore: {
      get: (key) => secrets.get(key) ?? null,
      set: (key, value) => { secrets.set(key, value); },
      delete: (key) => { secrets.delete(key); },
    },
  });
  controllers.push(controller);
  return { controller, secrets, gateway, requestBackend, fetchImpl, uplinkFactory, uplinks };
}

describe("Graft desktop relay", () => {
  it("requires account sign-in and never registers anonymously", async () => {
    const { controller, requestBackend, fetchImpl } = setup(false);
    await controller.sync();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(requestBackend).toHaveBeenLastCalledWith("/api/graft/connections/relay", expect.objectContaining({ state: "disabled" }));
  });

  it("registers once and renews a relay URL without sending secrets to the backend", async () => {
    const { controller, requestBackend, fetchImpl, uplinkFactory, uplinks } = setup();
    await controller.sync();
    await controller.sync();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(uplinkFactory).toHaveBeenCalledTimes(1);
    expect(uplinks[0]?.options.localHttpBaseUrl).toBe("http://127.0.0.1:49278");
    expect(requestBackend).toHaveBeenLastCalledWith("/api/graft/connections/relay", expect.objectContaining({ state: "connected", httpBaseUrl: credential.httpBaseUrl }));
    expect(JSON.stringify(requestBackend.mock.calls)).not.toContain(credential.uplinkSecret);
    expect(JSON.stringify(requestBackend.mock.calls)).not.toContain("account-token");
  });

  it("stops remote access when connections are disabled", async () => {
    const { controller, gateway, uplinks, requestBackend } = setup();
    await controller.sync();
    gateway.enabled = false;
    await controller.sync();
    expect(uplinks[0]?.stop).toHaveBeenCalled();
    expect(requestBackend).toHaveBeenLastCalledWith("/api/graft/connections/relay", expect.objectContaining({ state: "disabled" }));
  });

  it("keeps the public URL while moving the uplink to a restarted gateway", async () => {
    const { controller, gateway, uplinks, fetchImpl } = setup();
    await controller.sync();
    gateway.port = 49279;
    await controller.sync();
    expect(uplinks[0]?.stop).toHaveBeenCalled();
    expect(uplinks[1]?.options.localHttpBaseUrl).toBe("http://127.0.0.1:49279");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("signing out clears the account and uplink secrets and disconnects", async () => {
    const { controller, secrets, uplinks } = setup();
    await controller.sync();
    await controller.signOut();
    await controller.sync();
    expect(secrets.size).toBe(0);
    expect(uplinks).toHaveLength(1);
    expect(uplinks[0]?.stop).toHaveBeenCalled();
    expect(controller.getAccountStatus().signedIn).toBe(false);
  });

  it("does not reconnect when sign-out races with registration", async () => {
    const { controller, secrets, fetchImpl, uplinkFactory } = setup();
    let finish!: (response: Response) => void;
    fetchImpl.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = controller.sync();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const signingOut = controller.signOut();
    finish(Response.json(credential));
    await Promise.all([pending, signingOut]);
    expect(uplinkFactory).not.toHaveBeenCalled();
    expect(secrets.size).toBe(0);
  });
});
