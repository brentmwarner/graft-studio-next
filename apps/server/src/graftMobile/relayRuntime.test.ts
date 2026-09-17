import { Effect } from "effect";
import * as atomicWrite from "../atomicWrite";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraftAccountLoginServiceDependencies } from "./graftAccountLoginService";
import type { RelayStatus } from "./relayUplink";
import {
  connectMobileRelayAccount,
  connectMobileRelayWithAccount,
  disconnectMobileRelayAccount,
  getMobileRelayEndpoint,
  getMobileRelayStatus,
  initializeMobileRelay,
  parseMobileRelayCredential,
  setMobileRelayEnabled,
  stopMobileRelay,
  waitForMobileRelayPairing,
} from "./relayRuntime";

const mocks = vi.hoisted(() => ({
  uplinks: [] as Array<{
    options: { onStatus: (status: RelayStatus) => void; localHttpBaseUrl: string };
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }>,
  login: null as GraftAccountLoginServiceDependencies | null,
}));
vi.mock("./relayUplink", () => ({
  createRelayUplink: (options: {
    onStatus: (status: RelayStatus) => void;
    localHttpBaseUrl: string;
  }) => {
    const client = {
      options,
      start: vi.fn(() => options.onStatus({ state: "connecting", lastError: null })),
      stop: vi.fn(() => options.onStatus({ state: "disabled", lastError: null })),
    };
    mocks.uplinks.push(client);
    return client;
  },
}));
vi.mock("./graftAccountLoginService", () => ({
  GraftAccountLoginService: class {
    constructor(options: GraftAccountLoginServiceDependencies) {
      mocks.login = options;
    }
    async start() {
      return { ok: true };
    }
    async cancel() {}
    async dispose() {}
  },
}));

const credential = {
  environmentId: "computer-1",
  uplinkSecret: "uplink-secret-for-tests",
  httpBaseUrl: "https://relay.example/e/computer-1",
  wsBaseUrl: "wss://relay.example/e/computer-1",
  uplinkUrl: "wss://relay.example/relay/v1/uplink",
};
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "graft-relay-test-"));
  mocks.uplinks.length = 0;
  mocks.login = null;
});
afterEach(() => {
  stopMobileRelay();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

function initializeSaved() {
  writeFileSync(join(directory, "mobile-relay.json"), JSON.stringify(credential));
  initializeMobileRelay(5000, directory, {});
}

describe("mobile relay lifecycle", () => {
  it("starts only after connections are enabled and advertises the authenticated relay", () => {
    initializeSaved();
    expect(mocks.uplinks[0]!.start).not.toHaveBeenCalled();
    expect(getMobileRelayEndpoint()).toBeNull();
    setMobileRelayEnabled(true);
    expect(mocks.uplinks[0]!.start).toHaveBeenCalledOnce();
    mocks.uplinks[0]!.options.onStatus({ state: "connected", lastError: null });
    expect(getMobileRelayEndpoint()).toMatchObject({
      kind: "relay",
      httpBaseUrl: credential.httpBaseUrl,
    });
    setMobileRelayEnabled(false);
    expect(getMobileRelayEndpoint()).toBeNull();
    setMobileRelayEnabled(true);
    mocks.uplinks[0]!.options.onStatus({ state: "connected", lastError: null });
    expect(getMobileRelayEndpoint()?.httpBaseUrl).toBe(credential.httpBaseUrl);
  });

  it("fails pairing during an outage instead of silently saving a LAN address", async () => {
    vi.useFakeTimers();
    initializeSaved();
    setMobileRelayEnabled(true);
    const pairing = expect(waitForMobileRelayPairing()).rejects.toThrow("reconnecting");
    await vi.advanceTimersByTimeAsync(10_000);
    await pairing;
    expect(getMobileRelayEndpoint()).toBeNull();
  });

  it("resumes pairing once the relay recovers", async () => {
    vi.useFakeTimers();
    initializeSaved();
    setMobileRelayEnabled(true);
    const pairing = waitForMobileRelayPairing();
    mocks.uplinks[0]!.options.onStatus({ state: "connected", lastError: null });
    await vi.advanceTimersByTimeAsync(50);
    await expect(pairing).resolves.toBeUndefined();
  });

  it("stores only the scoped relay credential and restores it after restart", async () => {
    initializeMobileRelay(5000, directory, {});
    setMobileRelayEnabled(true);
    await connectMobileRelayAccount("My computer", vi.fn());
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(credential), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await mocks.login!.persistToken("private-account-token");
    const saved = readFileSync(join(directory, "mobile-relay.json"), "utf8");
    expect(JSON.parse(saved)).toEqual(credential);
    expect(saved).not.toContain("private-account-token");
    expect(statSync(join(directory, "mobile-relay.json")).mode & 0o777).toBe(0o600);
    expect(fetchMock.mock.calls[0]).toBeDefined();
    stopMobileRelay();
    initializeMobileRelay(5001, directory, {});
    setMobileRelayEnabled(true);
    mocks.uplinks.at(-1)!.options.onStatus({ state: "connected", lastError: null });
    expect(getMobileRelayEndpoint()?.httpBaseUrl).toBe(credential.httpBaseUrl);
  });

  it("registers the current desktop account without another login and stores only the scoped credential", async () => {
    initializeMobileRelay(5000, directory, {});
    setMobileRelayEnabled(true);
    const request = vi.fn(async () => new Response(JSON.stringify(credential)));
    vi.stubGlobal("fetch", request);
    await connectMobileRelayWithAccount("My computer", "desktop-account-token");
    expect(mocks.login).toBeNull();
    expect(request).toHaveBeenCalledWith(
      new URL("https://api.graftapp.io/relay/v1/environments"),
      expect.objectContaining({
        headers: {
          authorization: "Bearer desktop-account-token",
          "content-type": "application/json",
        },
      }),
    );
    expect(readFileSync(join(directory, "mobile-relay.json"), "utf8")).not.toContain(
      "desktop-account-token",
    );
    expect(mocks.uplinks.at(-1)!.start).toHaveBeenCalledOnce();
  });

  it("never forwards a production desktop token to an overridden account service", async () => {
    initializeMobileRelay(5000, directory, { GRAFT_CONTROL_PLANE_URL: "https://another.example" });
    setMobileRelayEnabled(true);
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(connectMobileRelayWithAccount("My computer", "private-token")).rejects.toThrow(
      "production Graft",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("opens the packaged sign-in URL through the injected platform opener", async () => {
    const openExternal = vi.fn();
    initializeMobileRelay(5000, directory, {});
    setMobileRelayEnabled(true);
    await connectMobileRelayAccount("My computer", openExternal);
    expect(mocks.login!.openExternal).toBe(openExternal);
  });

  it("proxies the uplink through the bound IPv6 loopback instead of 127.0.0.1", () => {
    writeFileSync(join(directory, "mobile-relay.json"), JSON.stringify(credential));
    initializeMobileRelay(5000, directory, {}, "::1");
    expect(mocks.uplinks[0]!.options.localHttpBaseUrl).toBe("http://[::1]:5000");
  });

  it("does not resurrect or save a login cancelled while registration is in flight", async () => {
    initializeMobileRelay(5000, directory, {});
    setMobileRelayEnabled(true);
    await connectMobileRelayAccount("My computer", vi.fn());
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const registration = mocks.login!.persistToken("account-token");
    setMobileRelayEnabled(false);
    finish(new Response(JSON.stringify(credential)));
    await expect(registration).rejects.toThrow("cancelled");
    expect(() => readFileSync(join(directory, "mobile-relay.json"))).toThrow();
    expect(getMobileRelayStatus().state).toBe("disabled");
    expect(mocks.uplinks).toHaveLength(0);
  });

  it("undoes a credential commit cancelled while persistence is finishing", async () => {
    initializeMobileRelay(5000, directory, {});
    setMobileRelayEnabled(true);
    await connectMobileRelayAccount("My computer", vi.fn());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(credential))),
    );
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const original = atomicWrite.writeFileStringAtomically;
    vi.spyOn(atomicWrite, "writeFileStringAtomically").mockImplementationOnce((input) =>
      original(input).pipe(Effect.flatMap(() => Effect.promise(() => pending))),
    );
    const registration = mocks.login!.persistToken("account-token");
    await vi.waitFor(() =>
      expect(readFileSync(join(directory, "mobile-relay.json"), "utf8")).toContain("computer-1"),
    );
    setMobileRelayEnabled(false);
    finish();
    await expect(registration).rejects.toThrow("cancelled");
    expect(() => readFileSync(join(directory, "mobile-relay.json"))).toThrow();
    expect(mocks.uplinks).toHaveLength(0);
    expect(getMobileRelayStatus().state).toBe("disabled");
  });

  it("persists account sign-out so restarting cannot restore the old relay or legacy import", async () => {
    initializeSaved();
    setMobileRelayEnabled(true);
    await disconnectMobileRelayAccount();
    expect(mocks.uplinks[0]!.stop).toHaveBeenCalled();
    expect(getMobileRelayEndpoint()).toBeNull();
    expect(() => readFileSync(join(directory, "mobile-relay.json"))).toThrow();
    const count = mocks.uplinks.length;
    initializeMobileRelay(5001, directory, {
      GRAFT_LEGACY_RELAY_CREDENTIAL: JSON.stringify(credential),
    });
    setMobileRelayEnabled(true);
    expect(mocks.uplinks).toHaveLength(count);
  });

  it("prefers the current credential over the legacy import", () => {
    writeFileSync(join(directory, "mobile-relay.json"), JSON.stringify(credential));
    initializeMobileRelay(5000, directory, { GRAFT_LEGACY_RELAY_CREDENTIAL: "invalid-legacy" });
    expect(mocks.uplinks).toHaveLength(1);
    expect(getMobileRelayStatus().state).toBe("disabled");
  });

  it("reports malformed credentials without leaking their contents", () => {
    initializeMobileRelay(5000, directory, {
      GRAFT_RELAY_CREDENTIAL: "private-invalid-credential",
    });
    setMobileRelayEnabled(true);
    expect(getMobileRelayStatus().state).toBe("error");
    expect(JSON.stringify(getMobileRelayStatus())).not.toContain("private-invalid");
    expect(mocks.uplinks).toHaveLength(0);
  });

  it.each([
    { httpBaseUrl: "http://relay.example/e/computer-1" },
    { wsBaseUrl: "wss://another.example/e/computer-1" },
    { uplinkUrl: "ws://relay.example/relay/v1/uplink" },
    { uplinkUrl: "wss://secret@relay.example/relay/v1/uplink" },
    { httpBaseUrl: "https://relay.example/e/other-computer" },
  ])("rejects unsafe or mismatched relay addresses %j", (override) => {
    expect(() =>
      parseMobileRelayCredential(JSON.stringify({ ...credential, ...override })),
    ).toThrow();
  });
});
